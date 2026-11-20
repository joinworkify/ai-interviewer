import "server-only";

import { applyOverrides, type ScoreOverride } from "@/lib/evaluation/overrides";
import type { CriterionScore, Recommendation } from "@/lib/evaluation/evaluate";
import { summarizeIntegrity, type IntegrityLevel } from "@/lib/integrity/events";
import { createAdminClient } from "@/lib/supabase/admin";

import type { ReviewStatus } from "./access";

export interface CompareColumn {
  sessionId: string;
  name: string;
  email: string | null;
  roleTitle: string | null;
  reviewStatus: ReviewStatus;
  overall: number | null;
  aiOverall: number | null;
  recommendation: Recommendation | null;
  /** Criterion name -> effective score (null = not covered). */
  scores: Record<string, number | null>;
  integrity: IntegrityLevel;
}

export const MAX_COMPARE = 4;

/** Light reads for the side-by-side page (no resume or recording links). Service role: callers check for an admin. */
export async function loadCompare(ids: string[]): Promise<CompareColumn[]> {
  const db = createAdminClient();
  const [sessions, evals, overrides, reviews, events, consents] = await Promise.all([
    db.from("interview_sessions").select("id, user_id").in("id", ids),
    db.from("interview_evaluations").select("session_id, status, criteria").in("session_id", ids),
    db.from("evaluation_overrides").select("session_id, criterion, score, reason, updated_at").in("session_id", ids),
    db.from("interview_reviews").select("session_id, status").in("session_id", ids),
    db.from("interview_integrity_events").select("session_id, kind, at_ms, duration_ms").in("session_id", ids),
    db.from("candidate_consents").select("session_id, role_id").in("session_id", ids),
  ]);
  for (const r of [sessions, evals, overrides, reviews, events, consents]) if (r.error) throw new Error("compare load failed");
  const userIds = [...new Set((sessions.data ?? []).map((s) => s.user_id))];
  const roleIds = [...new Set((consents.data ?? []).map((c) => c.role_id).filter(Boolean))];
  const [profiles, roles] = await Promise.all([
    userIds.length ? db.from("profiles").select("id, name, email").in("id", userIds) : { data: [], error: null },
    roleIds.length ? db.from("roles").select("id, title").in("id", roleIds) : { data: [], error: null },
  ]);
  if (profiles.error || roles.error) throw new Error("compare load failed");

  return ids.flatMap((id) => {
    const s = (sessions.data ?? []).find((x) => x.id === id);
    if (!s) return [];
    const profile = (profiles.data ?? []).find((p) => p.id === s.user_id);
    const roleId = (consents.data ?? []).find((c) => c.session_id === id)?.role_id;
    const ev = (evals.data ?? []).find((e) => e.session_id === id);
    const mine: ScoreOverride[] = (overrides.data ?? [])
      .filter((o) => o.session_id === id)
      .map((o) => ({ criterion: o.criterion, score: o.score, reason: o.reason, updatedAt: o.updated_at }));
    const effective =
      ev && ev.status === "completed" && Array.isArray(ev.criteria) ? applyOverrides(ev.criteria as unknown as CriterionScore[], mine) : null;
    return [
      {
        sessionId: id,
        name: profile?.name || profile?.email || "Candidate",
        email: profile?.email ?? null,
        roleTitle: roleId ? ((roles.data ?? []).find((r) => r.id === roleId)?.title ?? roleId) : null,
        reviewStatus: (reviews.data ?? []).find((r) => r.session_id === id)?.status ?? "pending",
        overall: effective?.overallScore ?? null,
        aiOverall: effective?.aiOverallScore ?? null,
        recommendation: effective?.recommendation ?? null,
        scores: Object.fromEntries((effective?.criteria ?? []).map((c) => [c.name, c.score])),
        integrity: summarizeIntegrity(
          (events.data ?? [])
            .filter((e) => e.session_id === id)
            .map((e) => ({ kind: e.kind, atMs: e.at_ms, ...(e.duration_ms !== null ? { durationMs: e.duration_ms } : {}) })),
        ).level,
      },
    ];
  });
}
