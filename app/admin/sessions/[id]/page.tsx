import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";

import { ResumeViewer } from "@/components/admin/resume-viewer-lazy";
import { ReviewStatusForm } from "@/components/admin/review-status-form";
import { REVIEW_STATUS_LABELS } from "@/lib/admin/access";
import { getAttempt } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/server";
import { isUuid } from "@/lib/sessions/validation";


function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

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
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
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

  return (
    <>
      <Link href="/admin" className="text-sm text-primary hover:underline">
        ← All interviews
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{a.candidate.name || a.candidate.email || "Candidate"}</h1>
          <p className="text-sm text-muted-foreground">{a.roleTitle ?? "Unknown role"}</p>
        </div>
        <div>
          <div className="mb-1 text-xs uppercase text-muted-foreground">
            Review status · {REVIEW_STATUS_LABELS[a.review.status]}
            {a.review.updatedAt && ` · updated ${formatDate(a.review.updatedAt)}`}
          </div>
          <ReviewStatusForm sessionId={a.sessionId} status={a.review.status} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <Section title="Candidate">
            <dl className="grid gap-3">
              <Field label="Name">{a.candidate.name || "—"}</Field>
              <Field label="Email">{a.candidate.email || "—"}</Field>
              <Field label="Phone">{a.candidate.phone || "—"}</Field>
              <Field label="LinkedIn"><ExternalLink href={a.candidate.linkedinUrl} /></Field>
              <Field label="Portfolio"><ExternalLink href={a.candidate.portfolioUrl} /></Field>
            </dl>
          </Section>

          <Section title="Interview">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Interview status"><span className="capitalize">{a.interviewStatus.replace("_", " ")}</span></Field>
              <Field label="Duration">
                {a.durationSeconds != null ? `${Math.round(a.durationSeconds / 60)} min` : "—"}
              </Field>
              <Field label="Started">{formatDate(a.startedAt)}</Field>
              <Field label="Ended">{formatDate(a.endedAt)}</Field>
              <Field label="Consent">
                {a.consent ? `Given ${formatDate(a.consent.acceptedAt)} (v${a.consent.version})` : "—"}
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
                    ({Math.max(1, Math.round(a.resume.size / 1024))} KB, uploaded {formatDate(a.resume.uploadedAt)})
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
                  <p className="text-xs text-muted-foreground">Preview is only available for PDF resumes.</p>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>

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
                    <div className={`mb-1 text-xs font-semibold uppercase ${ai ? "text-primary" : "text-foreground"}`}>
                      {ai ? "AI interviewer" : t.role === "candidate" ? "Candidate" : "Speaker"}
                    </div>
                    <p className="whitespace-pre-wrap">{t.text}</p>
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
