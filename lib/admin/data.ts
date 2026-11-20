import "server-only";

import {
  createS3Client,
  createS3ResumeStorage,
  readResumeS3Config,
} from "@/lib/candidate/resume-s3";
import { normalizeTranscript, type TranscriptTurn } from "@/lib/sessions/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import { toStoredEvaluation, type StoredEvaluation } from "@/lib/evaluation/store";
import { applyOverrides, type ScoreOverride } from "@/lib/evaluation/overrides";
import type { CriterionScore } from "@/lib/evaluation/evaluate";
import { secondsOver } from "@/lib/tasks/tasks";
import {
  summarizeIntegrity,
  type IntegrityEvent,
  type IntegritySummary,
} from "@/lib/integrity/events";

import type { ReviewStatus } from "./access";

/**
 * Reads for the admin dashboard. Uses the service-role client, so callers MUST
 * have checked the user is an admin first (app/admin/layout.tsx does).
 */

// shortcut: the list loads the newest 500 attempts and filters in memory;
// move filtering and paging into the query once there are more candidates.
const LIST_LIMIT = 500;

export interface AttemptListItem {
  sessionId: string;
  userId: string;
  name: string | null;
  email: string | null;
  roleTitle: string | null;
  interviewStatus: string;
  reviewStatus: ReviewStatus;
  hasResume: boolean;
  /** The candidate sent at least one problem report for this interview. */
  problemReported: boolean;
  /** AI rubric score 0-100 (reviewer overrides applied); null when not scored (yet). */
  score: number | null;
  /** The admin responsible for reviewing it; null when unassigned. */
  assignedTo: string | null;
  startedAt: string;
}

function fail(op: string, error: unknown): never {
  console.error(`[admin-data] ${op} failed`, (error as { code?: string } | null)?.code ?? "");
  throw new Error(`${op} failed`);
}

export async function listAttempts(): Promise<AttemptListItem[]> {
  const db = createAdminClient();
  const sessions = await db
    .from("interview_sessions")
    .select("id, user_id, status, started_at")
    .order("started_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (sessions.error) fail("list sessions", sessions.error);
  const rows = sessions.data ?? [];
  if (rows.length === 0) return [];

  const sessionIds = rows.map((s) => s.id);
  const userIds = [...new Set(rows.map((s) => s.user_id))];
  const [consents, reviews, profiles, resumes, reports, evaluations, overrides] = await Promise.all(
    [
      db.from("candidate_consents").select("session_id, role_id").in("session_id", sessionIds),
      db
        .from("interview_reviews")
        .select("session_id, status, assigned_to")
        .in("session_id", sessionIds),
      db.from("profiles").select("id, name, email").in("id", userIds),
      db
        .from("candidate_resumes")
        .select("user_id")
        .eq("status", "uploaded")
        .in("user_id", userIds),
      db.from("interview_problem_reports").select("session_id").in("session_id", sessionIds),
      db
        .from("interview_evaluations")
        .select("session_id, overall_score, criteria")
        .in("session_id", sessionIds),
      db
        .from("evaluation_overrides")
        .select("session_id, criterion, score, reason, updated_at")
        .in("session_id", sessionIds),
    ],
  );
  for (const [op, r] of [
    ["consents", consents],
    ["reviews", reviews],
    ["profiles", profiles],
    ["resumes", resumes],
    ["reports", reports],
    ["evaluations", evaluations],
    ["overrides", overrides],
  ] as const) {
    if (r.error) fail(op, r.error);
  }

  const roleBySession = new Map((consents.data ?? []).map((c) => [c.session_id, c.role_id]));
  const reviewBySession = new Map((reviews.data ?? []).map((r) => [r.session_id, r.status]));
  const assigneeBySession = new Map((reviews.data ?? []).map((r) => [r.session_id, r.assigned_to]));
  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const withResume = new Set((resumes.data ?? []).map((r) => r.user_id));
  const reported = new Set((reports.data ?? []).map((r) => r.session_id));
  // The score a reviewer sees: the AI's, with any reviewer overrides applied.
  const overridesBySession = new Map<string, ScoreOverride[]>();
  for (const o of overrides.data ?? []) {
    overridesBySession.set(o.session_id, [
      ...(overridesBySession.get(o.session_id) ?? []),
      { criterion: o.criterion, score: o.score, reason: o.reason, updatedAt: o.updated_at },
    ]);
  }
  const scoreBySession = new Map(
    (evaluations.data ?? []).map((e) => {
      const mine = overridesBySession.get(e.session_id);
      if (!mine || !Array.isArray(e.criteria) || e.overall_score === null)
        return [e.session_id, e.overall_score] as const;
      return [
        e.session_id,
        applyOverrides(e.criteria as unknown as CriterionScore[], mine).overallScore,
      ] as const;
    }),
  );

  const roleIds = [
    ...new Set(
      (consents.data ?? [])
        .map((c) => c.role_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const roles =
    roleIds.length > 0
      ? await db.from("roles").select("id, title").in("id", roleIds)
      : { data: [], error: null };
  if (roles.error) fail("roles", roles.error);
  const roleTitleById = new Map((roles.data ?? []).map((r) => [r.id, r.title]));

  return rows.map((s) => {
    const roleId = roleBySession.get(s.id);
    return {
      sessionId: s.id,
      userId: s.user_id,
      name: profileById.get(s.user_id)?.name ?? null,
      email: profileById.get(s.user_id)?.email ?? null,
      roleTitle: roleId ? (roleTitleById.get(roleId) ?? roleId) : null,
      interviewStatus: s.status,
      reviewStatus: reviewBySession.get(s.id) ?? "pending",
      hasResume: withResume.has(s.user_id),
      problemReported: reported.has(s.id),
      score: scoreBySession.get(s.id) ?? null,
      assignedTo: assigneeBySession.get(s.id) ?? null,
      startedAt: s.started_at,
    };
  });
}

export interface AttemptDetail {
  sessionId: string;
  interviewStatus: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  endedReason: string | null;
  roleTitle: string | null;
  consent: { version: string; acceptedAt: string } | null;
  review: { status: ReviewStatus; updatedAt: string | null; assignedTo: string | null };
  /** Internal notes by admins, oldest first. */
  notes: {
    id: string;
    authorId: string | null;
    authorName: string;
    body: string;
    createdAt: string;
  }[];
  candidate: {
    name: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    portfolioUrl: string | null;
  };
  resume: {
    fileName: string;
    size: number;
    uploadedAt: string | null;
    downloadUrl: string | null;
    /** Short-lived inline link for an iframe; only set for PDFs. */
    previewUrl: string | null;
  } | null;
  /** The saved interview conversation in order; empty when there is none or it is unreadable. */
  transcript: TranscriptTurn[];
  problemReports: { kind: string; message: string; createdAt: string }[];
  /** The AI rubric score, or why there is none; null before scoring ran. */
  evaluation: StoredEvaluation | null;
  /** Work-sample answers the candidate gave, in task order; empty when the role has none. */
  taskWork: {
    taskId: string;
    title: string;
    kind: string;
    minutes: number;
    answer: string;
    submitted: boolean;
    secondsOver: number;
    pasteCount: number;
    awayMs: number;
  }[];
  /** Reviewer overrides of criterion scores. */
  overrides: ScoreOverride[];
  /** What the browser saw during the call, and a rough level. */
  integrity: { events: IntegrityEvent[]; summary: IntegritySummary };
  /** The setup camera snapshot, with a short-lived link; null when skipped. */
  identityPhotoUrl: string | null;
  /** The model's review of the recording; null before it ran. */
  audioReview: {
    status: "completed" | "failed";
    secondVoice: boolean | null;
    readingAloud: boolean | null;
    notes: string;
    criteria: CriterionScore[];
    overall: number | null;
    errorCode: string | null;
  } | null;
  /** The saved audio of the interview with a short-lived link; null when none. */
  recording: {
    url: string;
    contentType: string;
    sizeBytes: number;
    uploadedAt: string | null;
  } | null;
}

/** Saved transcript (any shape normalizeTranscript accepts) as ordered turns; [] if missing or unreadable. */
export function transcriptTurns(value: unknown): TranscriptTurn[] {
  if (value == null) return [];
  const result = normalizeTranscript(value);
  return result.ok ? result.turns : [];
}

export async function getAttempt(sessionId: string): Promise<AttemptDetail | null> {
  const db = createAdminClient();
  const session = await db
    .from("interview_sessions")
    .select("id, user_id, status, started_at, ended_at, duration_seconds, ended_reason, transcript")
    .eq("id", sessionId)
    .maybeSingle();
  if (session.error) fail("get session", session.error);
  const s = session.data;
  if (!s) return null;

  const [
    consent,
    review,
    profile,
    resume,
    reports,
    evaluation,
    recording,
    overrideRows,
    integrityRows,
    photo,
    audio,
    noteRows,
    submissionRows,
  ] = await Promise.all([
    db
      .from("candidate_consents")
      .select("role_id, consent_version, accepted_at")
      .eq("session_id", s.id)
      .maybeSingle(),
    db
      .from("interview_reviews")
      .select("status, updated_at, assigned_to")
      .eq("session_id", s.id)
      .maybeSingle(),
    db
      .from("profiles")
      .select("name, email, phone, linkedin_url, portfolio_url")
      .eq("id", s.user_id)
      .maybeSingle(),
    db
      .from("candidate_resumes")
      .select("s3_key, file_name, size_bytes, uploaded_at")
      .eq("user_id", s.user_id)
      .eq("status", "uploaded")
      // The resume in use: last selected by the candidate, then last uploaded.
      .order("selected_at", { ascending: false, nullsFirst: false })
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("interview_problem_reports")
      .select("kind, message, created_at")
      .eq("session_id", s.id)
      .order("created_at", { ascending: true }),
    db.from("interview_evaluations").select("*").eq("session_id", s.id).maybeSingle(),
    db
      .from("interview_recordings")
      .select("s3_key, content_type, size_bytes, uploaded_at")
      .eq("session_id", s.id)
      .eq("status", "uploaded")
      .maybeSingle(),
    db
      .from("evaluation_overrides")
      .select("criterion, score, reason, updated_at")
      .eq("session_id", s.id),
    db
      .from("interview_integrity_events")
      .select("kind, at_ms, duration_ms")
      .eq("session_id", s.id)
      .order("at_ms", { ascending: true }),
    db.from("interview_identity_photos").select("s3_key").eq("session_id", s.id).maybeSingle(),
    db.from("interview_audio_reviews").select("*").eq("session_id", s.id).maybeSingle(),
    db
      .from("reviewer_notes")
      .select("id, author_id, author_name, body, created_at")
      .eq("session_id", s.id)
      .order("created_at", { ascending: true }),
    db
      .from("task_submissions")
      .select("task_id, answer, started_at, submitted_at, paste_count, away_ms")
      .eq("session_id", s.id),
  ]);
  for (const [op, r] of [
    ["consent", consent],
    ["review", review],
    ["profile", profile],
    ["resume", resume],
    ["reports", reports],
    ["evaluation", evaluation],
    ["recording", recording],
    ["overrides", overrideRows],
    ["integrity", integrityRows],
    ["photo", photo],
    ["audio", audio],
    ["notes", noteRows],
    ["tasks", submissionRows],
  ] as const) {
    if (r.error) fail(op, r.error);
  }

  let downloadUrl: string | null = null;
  let previewUrl: string | null = null;
  const s3 = readResumeS3Config(process.env);
  if (resume.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    downloadUrl = await storage.presignGet(resume.data.s3_key, resume.data.file_name, 300);
    if (/\.pdf$/i.test(resume.data.file_name)) {
      previewUrl = await storage.presignGet(
        resume.data.s3_key,
        resume.data.file_name,
        300,
        "inline",
      );
    }
  }

  let recordingInfo: AttemptDetail["recording"] = null;
  if (recording.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    // Longer than the resume links: a reviewer may listen for a while.
    const url = await storage.presignGet(
      recording.data.s3_key,
      "interview-recording",
      3600,
      "inline",
      recording.data.content_type,
    );
    recordingInfo = {
      url,
      contentType: recording.data.content_type,
      sizeBytes: recording.data.size_bytes,
      uploadedAt: recording.data.uploaded_at,
    };
  }

  let identityPhotoUrl: string | null = null;
  if (photo.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    identityPhotoUrl = await storage.presignGet(
      photo.data.s3_key,
      "photo.jpg",
      300,
      "inline",
      "image/jpeg",
    );
  }
  const integrityEvents: IntegrityEvent[] = (integrityRows.data ?? []).map((e) => ({
    kind: e.kind,
    atMs: e.at_ms,
    ...(e.duration_ms !== null ? { durationMs: e.duration_ms } : {}),
  }));

  let taskWork: AttemptDetail["taskWork"] = [];
  if (consent.data?.role_id) {
    const defs = await db
      .from("role_tasks")
      .select("id, title, kind, minutes")
      .eq("role_id", consent.data.role_id)
      .order("position", { ascending: true });
    if (defs.error) fail("tasks", defs.error);
    taskWork = (defs.data ?? []).map((d) => {
      const sub = (submissionRows.data ?? []).find((x) => x.task_id === d.id);
      const done = !!sub?.submitted_at;
      return {
        taskId: d.id,
        title: d.title,
        kind: d.kind,
        minutes: d.minutes,
        answer: sub?.answer ?? "",
        submitted: done,
        secondsOver:
          sub && done
            ? secondsOver({
                startedAt: new Date(sub.started_at),
                submittedAt: new Date(sub.submitted_at!),
                minutes: d.minutes,
              })
            : 0,
        pasteCount: sub?.paste_count ?? 0,
        awayMs: sub?.away_ms ?? 0,
      };
    });
  }

  let recordingInfo: AttemptDetail["recording"] = null;
  if (recording.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    // Longer than the resume links: a reviewer may listen for a while.
    const url = await storage.presignGet(
      recording.data.s3_key,
      "interview-recording",
      3600,
      "inline",
      recording.data.content_type,
    );
    recordingInfo = {
      url,
      contentType: recording.data.content_type,
      sizeBytes: recording.data.size_bytes,
      uploadedAt: recording.data.uploaded_at,
    };
  }

  let identityPhotoUrl: string | null = null;
  if (photo.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    identityPhotoUrl = await storage.presignGet(
      photo.data.s3_key,
      "photo.jpg",
      300,
      "inline",
      "image/jpeg",
    );
  }
  const integrityEvents: IntegrityEvent[] = (integrityRows.data ?? []).map((e) => ({
    kind: e.kind,
    atMs: e.at_ms,
    ...(e.duration_ms !== null ? { durationMs: e.duration_ms } : {}),
  }));

  let taskWork: AttemptDetail["taskWork"] = [];
  if (consent.data?.role_id) {
    const defs = await db
      .from("role_tasks")
      .select("id, title, kind, minutes")
      .eq("role_id", consent.data.role_id)
      .order("position", { ascending: true });
    if (defs.error) fail("tasks", defs.error);
    taskWork = (defs.data ?? []).map((d) => {
      const sub = (submissionRows.data ?? []).find((x) => x.task_id === d.id);
      const done = !!sub?.submitted_at;
      return {
        taskId: d.id,
        title: d.title,
        kind: d.kind,
        minutes: d.minutes,
        answer: sub?.answer ?? "",
        submitted: done,
        secondsOver:
          sub && done
            ? secondsOver({
                startedAt: new Date(sub.started_at),
                submittedAt: new Date(sub.submitted_at!),
                minutes: d.minutes,
              })
            : 0,
        pasteCount: sub?.paste_count ?? 0,
        awayMs: sub?.away_ms ?? 0,
      };
    });
  }

  let roleTitle: string | null = null;
  if (consent.data?.role_id) {
    const role = await db
      .from("roles")
      .select("title")
      .eq("id", consent.data.role_id)
      .maybeSingle();
    if (role.error) fail("role", role.error);
    roleTitle = role.data?.title ?? consent.data.role_id;
  }

  return {
    sessionId: s.id,
    interviewStatus: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    durationSeconds: s.duration_seconds,
    endedReason: s.ended_reason,
    roleTitle,
    consent: consent.data
      ? { version: consent.data.consent_version, acceptedAt: consent.data.accepted_at }
      : null,
    review: {
      status: review.data?.status ?? "pending",
      updatedAt: review.data?.updated_at ?? null,
      assignedTo: review.data?.assigned_to ?? null,
    },
    notes: (noteRows.data ?? []).map((n) => ({
      id: n.id,
      authorId: n.author_id,
      authorName: n.author_name,
      body: n.body,
      createdAt: n.created_at,
    })),
    candidate: {
      name: profile.data?.name ?? null,
      email: profile.data?.email ?? null,
      phone: profile.data?.phone ?? null,
      linkedinUrl: profile.data?.linkedin_url ?? null,
      portfolioUrl: profile.data?.portfolio_url ?? null,
    },
    resume: resume.data
      ? {
          fileName: resume.data.file_name,
          size: resume.data.size_bytes,
          uploadedAt: resume.data.uploaded_at,
          downloadUrl,
          previewUrl,
        }
      : null,
    transcript: transcriptTurns(s.transcript),
    problemReports: (reports.data ?? []).map((r) => ({
      kind: r.kind,
      message: r.message,
      createdAt: r.created_at,
    })),
    evaluation: evaluation.data ? toStoredEvaluation(evaluation.data) : null,
    taskWork,
    overrides: (overrideRows.data ?? []).map((o) => ({
      criterion: o.criterion,
      score: o.score,
      reason: o.reason,
      updatedAt: o.updated_at,
    })),
    integrity: { events: integrityEvents, summary: summarizeIntegrity(integrityEvents) },
    identityPhotoUrl,
    audioReview: audio.data
      ? {
          status: audio.data.status,
          secondVoice: audio.data.second_voice,
          readingAloud: audio.data.reading_aloud,
          notes: audio.data.notes,
          criteria: Array.isArray(audio.data.audio_criteria)
            ? (audio.data.audio_criteria as unknown as CriterionScore[])
            : [],
          overall: audio.data.audio_overall,
          errorCode: audio.data.error_code,
        }
      : null,
    recording: recordingInfo,
  };
}
