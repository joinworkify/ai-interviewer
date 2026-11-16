import "server-only";

import { findRole } from "@/lib/candidate/attempts";
import { createS3Client, createS3ResumeStorage, readResumeS3Config } from "@/lib/candidate/resume-s3";
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

function roleTitle(roleId: string | undefined): string | null {
  if (!roleId) return null;
  return findRole(roleId)?.title ?? roleId;
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
  for (const [op, r] of [["consents", consents], ["reviews", reviews], ["profiles", profiles], ["resumes", resumes]] as const) {
    if (r.error) fail(op, r.error);
  }

  const roleBySession = new Map((consents.data ?? []).map((c) => [c.session_id, c.role_id]));
  const reviewBySession = new Map((reviews.data ?? []).map((r) => [r.session_id, r.status]));
  const profileById = new Map((profiles.data ?? []).map((p) => [p.id, p]));
  const withResume = new Set((resumes.data ?? []).map((r) => r.user_id));

  return rows.map((s) => ({
    sessionId: s.id,
    userId: s.user_id,
    name: profileById.get(s.user_id)?.name ?? null,
    email: profileById.get(s.user_id)?.email ?? null,
    roleTitle: roleTitle(roleBySession.get(s.id)),
    interviewStatus: s.status,
    reviewStatus: reviewBySession.get(s.id) ?? "pending",
    hasResume: withResume.has(s.user_id),
    startedAt: s.started_at,
  }));
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
  resume:
    | { fileName: string; size: number; uploadedAt: string | null; downloadUrl: string | null }
    | null;
  transcript: TranscriptTurn[];
  feedback: {
    totalScore: number | null;
    strengths: string[];
    areasForImprovement: string[];
    finalAssessment: string | null;
  } | null;
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

  const [consent, review, profile, resume, feedback] = await Promise.all([
    db.from("candidate_consents").select("role_id, consent_version, accepted_at").eq("session_id", s.id).maybeSingle(),
    db.from("interview_reviews").select("status, updated_at").eq("session_id", s.id).maybeSingle(),
    db.from("profiles").select("name, email, phone, linkedin_url, portfolio_url").eq("id", s.user_id).maybeSingle(),
    db
      .from("candidate_resumes")
      .select("s3_key, file_name, size_bytes, uploaded_at")
      .eq("user_id", s.user_id)
      .eq("status", "uploaded")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("feedback")
      .select("total_score, strengths, areas_for_improvement, final_assessment")
      .eq("session_id", s.id)
      .maybeSingle(),
  ]);
  for (const [op, r] of [["consent", consent], ["review", review], ["profile", profile], ["resume", resume], ["feedback", feedback]] as const) {
    if (r.error) fail(op, r.error);
  }

  let downloadUrl: string | null = null;
  const s3 = readResumeS3Config(process.env);
  if (resume.data && s3.ok) {
    const storage = createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket);
    downloadUrl = await storage.presignGet(resume.data.s3_key, resume.data.file_name, 300);
  }

  const transcript = s.transcript == null ? null : normalizeTranscript(s.transcript);

  return {
    sessionId: s.id,
    interviewStatus: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    durationSeconds: s.duration_seconds,
    endedReason: s.ended_reason,
    roleTitle: roleTitle(consent.data?.role_id),
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
        }
      : null,
    transcript: transcript?.ok ? transcript.turns : [],
    feedback: feedback.data
      ? {
          totalScore: feedback.data.total_score,
          strengths: feedback.data.strengths,
          areasForImprovement: feedback.data.areas_for_improvement,
          finalAssessment: feedback.data.final_assessment,
        }
      : null,
  };
}
