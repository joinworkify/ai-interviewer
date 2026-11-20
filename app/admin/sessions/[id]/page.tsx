import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AssignPicker, Notes } from "@/components/admin/assign-and-notes";
import { EvaluationPanel } from "@/components/admin/evaluation-panel";
import { IntegrityPanel } from "@/components/admin/integrity-panel";
import { ResumeViewer } from "@/components/admin/resume-viewer-lazy";
import { ReviewStatusForm } from "@/components/admin/review-status-form";
import { REVIEW_STATUS_LABELS } from "@/lib/admin/access";
import { getAttempt } from "@/lib/admin/data";
import { getCaller, requireAdmin } from "@/lib/admin/server";
import { listAdmins } from "@/lib/admin/workflow-server";
import { isUuid } from "@/lib/sessions/validation";

function formatDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "—";
}

const PROBLEM_LABELS: Record<string, string> = {
  lost_internet: "Lost internet",
  microphone: "Microphone problem",
  audio: "Couldn't hear the interviewer",
  other: "Other",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function ExternalLink({ href }: { href: string | null }) {
  // Only http(s) links are stored (a DB constraint enforces it), but check anyway.
  if (!href || !/^https?:\/\//i.test(href)) return <>—</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {href}
    </a>
  );
}

async function AdminSessionPageContent({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const a = await getAttempt(id);
  if (!a) notFound();
  const me = (await getCaller())?.userId ?? "";
  // The picker is a convenience: if the admin list cannot load, the page still works.
  const admins = await listAdmins().catch(() => []);

  return (
    <>
      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← All interviews
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {a.candidate.name || a.candidate.email || "Candidate"}
          </h1>
          <p className="text-sm text-muted-foreground">{a.roleTitle ?? "Unknown role"}</p>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase text-muted-foreground">
            Review status · {REVIEW_STATUS_LABELS[a.review.status]}
            {a.review.updatedAt && ` · updated ${formatDate(a.review.updatedAt)}`}
          </div>
          <ReviewStatusForm sessionId={a.sessionId} status={a.review.status} />
          <div className="mt-3 mb-1 text-xs uppercase text-muted-foreground">Assigned reviewer</div>
          <AssignPicker sessionId={a.sessionId} assignedTo={a.review.assignedTo} admins={admins} />
        </div>
      </div>

      {a.problemReports.length > 0 && (
        <div
          role="note"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-semibold">The candidate reported a problem with this interview</p>
          <ul className="mt-2 grid gap-2">
            {a.problemReports.map((r) => (
              <li key={r.createdAt}>
                <span className="font-medium">{PROBLEM_LABELS[r.kind] ?? r.kind}</span>
                <span className="text-red-800"> · {formatDate(r.createdAt)}</span>
                {r.message && <p className="whitespace-pre-wrap">{r.message}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <Section title="Candidate">
            <dl className="grid gap-3">
              <Field label="Name">{a.candidate.name || "—"}</Field>
              <Field label="Email">{a.candidate.email || "—"}</Field>
              <Field label="Phone">{a.candidate.phone || "—"}</Field>
              <Field label="LinkedIn">
                <ExternalLink href={a.candidate.linkedinUrl} />
              </Field>
              <Field label="Portfolio">
                <ExternalLink href={a.candidate.portfolioUrl} />
              </Field>
            </dl>
          </Section>

          <Section title="Interview">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Interview status">
                <span className="capitalize">{a.interviewStatus.replace("_", " ")}</span>
              </Field>
              <Field label="Duration">
                {a.durationSeconds != null ? `${Math.round(a.durationSeconds / 60)} min` : "—"}
              </Field>
              <Field label="Started">{formatDate(a.startedAt)}</Field>
              <Field label="Ended">{formatDate(a.endedAt)}</Field>
              <Field label="Consent">
                {a.consent
                  ? `Given ${formatDate(a.consent.acceptedAt)} (v${a.consent.version})`
                  : "—"}
              </Field>
              <Field label="End reason">{a.endedReason || "—"}</Field>
            </dl>
          </Section>
        </div>

        <div className="lg:sticky lg:top-4">
          <Section title="Resume">
            {!a.resume ? (
              <p className="text-sm text-muted-foreground">No resume uploaded.</p>
            ) : (
              <div className="grid gap-3">
                <p>
                  <span className="font-medium">{a.resume.fileName}</span>{" "}
                  <span className="text-sm text-muted-foreground">
                    ({Math.max(1, Math.round(a.resume.size / 1024))} KB, uploaded{" "}
                    {formatDate(a.resume.uploadedAt)})
                  </span>
                </p>
                {a.resume.previewUrl && (
                  <ResumeViewer url={a.resume.previewUrl} fileName={a.resume.fileName} />
                )}
                {a.resume.downloadUrl ? (
                  <a
                    href={a.resume.downloadUrl}
                    className="w-fit rounded-md bg-primary px-4 py-2 font-ui text-sm font-medium text-primary-foreground"
                  >
                    Download resume
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">Resume storage is not configured.</p>
                )}
                {!a.resume.previewUrl && a.resume.downloadUrl && (
                  <p className="text-xs text-muted-foreground">
                    Preview is only available for PDF resumes.
                  </p>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>

      <Section title="AI score">
        <EvaluationPanel
          sessionId={a.sessionId}
          evaluation={a.evaluation}
          hasTranscript={a.transcript.length > 0}
          overrides={a.overrides}
        />
      </Section>

      <Section title="Recording">
        {a.recording ? (
          <div className="grid gap-2">
            {/* Short-lived signed link; the audio never passes through this server. */}
            <audio controls preload="metadata" className="w-full" src={a.recording.url}>
              Your browser cannot play this recording.
            </audio>
            <p className="text-xs text-muted-foreground">
              Candidate and interviewer, mixed.{" "}
              {Math.max(1, Math.round(a.recording.sizeBytes / 1024))} KB
              {a.recording.uploadedAt && ` · saved ${formatDate(a.recording.uploadedAt)}`}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recording for this interview. Interviews taken before recording was added, and ones
            where the browser could not record or upload, have none.
          </p>
        )}
      </Section>

      <Section title="Integrity">
        <IntegrityPanel a={a} />
      </Section>

      {a.taskWork.length > 0 && (
        <Section title="Work samples">
          <ul className="grid gap-5">
            {a.taskWork.map((t) => (
              <li key={t.taskId} className="grid gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.submitted
                      ? t.secondsOver > 120
                        ? `Submitted ${Math.round(t.secondsOver / 60)} min late`
                        : "On time"
                      : "Not submitted"}
                    {t.submitted &&
                      ` · ${t.pasteCount} paste${t.pasteCount === 1 ? "" : "s"} · ${Math.round(t.awayMs / 1000)} s away from the page`}
                  </p>
                </div>
                {t.submitted ? (
                  <pre
                    className={`max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm ${t.kind === "coding" ? "font-mono" : "font-sans"}`}
                  >
                    {t.answer}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    The candidate did not submit this task.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Reviewer notes">
        <Notes sessionId={a.sessionId} notes={a.notes} meId={me} />
      </Section>

      <Section title="Transcript">
        {a.transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcript yet.</p>
        ) : (
          <ol className="grid gap-3">
            {a.transcript.map((t, i) => {
              const ai = t.role === "interviewer";
              return (
                <li key={i} className={`flex ${ai ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                      ai ? "border-l-4 border-primary bg-muted/40" : "bg-primary/10"
                    }`}
                  >
                    <div
                      className={`mb-1 text-xs font-semibold uppercase ${ai ? "text-primary" : "text-foreground"}`}
                    >
                      {ai ? "AI interviewer" : t.role === "candidate" ? "Candidate" : "Speaker"}
                    </div>
                    <p className="whitespace-pre-wrap">{t.text}</p>
                    {t.original && (
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          Corrected by AI: show original caption
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">{t.original}</p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </>
  );
}

export default function AdminSessionPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <AdminSessionPageContent {...props} />
    </Suspense>
  );
}

export const metadata = { title: "Review interview" };
