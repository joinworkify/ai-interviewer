import "server-only";

import {
  createS3Client,
  createS3ResumeStorage,
  readResumeS3Config,
} from "@/lib/candidate/resume-s3";
import { normalizeTranscript, type TranscriptTurn } from "@/lib/sessions/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const [consents, reviews, profiles, resumes] = await Promise.all([
    db.from("candidate_consents").select("session_id, role_id").in("session_id", sessionIds),
    db.from("interview_reviews").select("session_id, status").in("session_id", sessionIds),
    db.from("profiles").select("id, name, email").in("id", userIds),
    db.from("candidate_resumes").select("user_id").eq("status", "uploaded").in("user_id", userIds),
  ]);
  for (const [op, r] of [
    ["consents", consents],
    ["reviews", reviews],
    ["profiles", profiles],
    ["resumes", resumes],
  ] as const) {
    if (r.error) fail(op, r.error);
  }

  const roleBySession = new Map((consents.data ?? []).map((c) => [c.session_id, c.role_id]));
  const reviewBySession = new Map((reviews.data ?? []).map((r) => [r.session_id, r.status]));
  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const withResume = new Set((resumes.data ?? []).map((r) => r.user_id));

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
  review: { status: ReviewStatus; updatedAt: string | null };
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

  const [consent, review, profile, resume] = await Promise.all([
    db
      .from("candidate_consents")
      .select("role_id, consent_version, accepted_at")
      .eq("session_id", s.id)
      .maybeSingle(),
    db.from("interview_reviews").select("status, updated_at").eq("session_id", s.id).maybeSingle(),
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
  ]);
  for (const [op, r] of [
    ["consent", consent],
    ["review", review],
    ["profile", profile],
    ["resume", resume],
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
    },
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
  };
}
