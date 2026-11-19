import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseUsageStore } from "@/lib/ai/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

import type { CriterionScore, Recommendation, RubricEvaluation } from "./evaluate";
import { runRubricEvaluation, type EvaluationOutcome, type EvaluationStore } from "./run";

/**
 * Persistence for rubric evaluations. Needs the service-role client: the table
 * has no browser access. Callers must have checked who is asking (the
 * transcript route knows the signed-in owner; the admin route checks admin).
 */

class EvaluationStoreError extends Error {}

function fail(op: string, error: { code?: string } | null): never {
  // Op name and Postgres code only: messages can quote row values.
  console.error(`[evaluation-store] ${op} failed`, error?.code ?? "");
  throw new EvaluationStoreError(`${op} failed`);
}

export function createSupabaseEvaluationStore(db: SupabaseClient<Database>): EvaluationStore {
  return {
    async load(sessionId) {
      const session = await db
        .from("interview_sessions")
        .select("id, user_id, transcript")
        .eq("id", sessionId)
        .maybeSingle();
      if (session.error) fail("load session", session.error);
      if (!session.data) return null;

      let roleTitle: string | null = null;
      let rubric: unknown = [];
      const consent = await db
        .from("candidate_consents")
        .select("role_id")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (consent.error) fail("load consent", consent.error);
      if (consent.data?.role_id) {
        const [role, rubricRow] = await Promise.all([
          db.from("roles").select("title").eq("id", consent.data.role_id).maybeSingle(),
          db.from("role_rubrics").select("criteria").eq("role_id", consent.data.role_id).maybeSingle(),
        ]);
        if (role.error) fail("load role", role.error);
        if (rubricRow.error) fail("load rubric", rubricRow.error);
        roleTitle = role.data?.title ?? null;
        rubric = rubricRow.data?.criteria ?? [];
      }
      // Work samples the candidate submitted (empty for roles with no tasks).
      const subs = await db
        .from("task_submissions")
        .select("answer, task_id")
        .eq("session_id", sessionId)
        .not("submitted_at", "is", null);
      if (subs.error) fail("load tasks", subs.error);
      let tasks: { title: string; kind: string; answer: string }[] = [];
      if ((subs.data ?? []).length > 0) {
        const defs = await db.from("role_tasks").select("id, title, kind").in("id", subs.data!.map((x) => x.task_id));
        if (defs.error) fail("load task definitions", defs.error);
        tasks = subs.data!.flatMap((x) => {
          const d = defs.data?.find((t) => t.id === x.task_id);
          return d ? [{ title: d.title, kind: d.kind, answer: x.answer }] : [];
        });
      }
      return {
        sessionId,
        userId: session.data.user_id,
        transcript: session.data.transcript,
        roleTitle,
        rubric,
        tasks,
      };
    },

    async hasCompleted(sessionId) {
      const { data, error } = await db
        .from("interview_evaluations")
        .select("status")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) fail("check evaluation", error);
      return data?.status === "completed";
    },

    async saveCompleted(sessionId, evaluation, model) {
      const { error } = await db.from("interview_evaluations").upsert({
        session_id: sessionId,
        status: "completed",
        overall_score: evaluation.overallScore,
        recommendation: evaluation.recommendation,
        summary: evaluation.summary,
        strengths: evaluation.strengths,
        concerns: evaluation.concerns,
        criteria: evaluation.criteria as unknown as Json,
        model,
        error_code: null,
        updated_at: new Date().toISOString(),
      });
      if (error) fail("save evaluation", error);
    },

    async saveFailed(sessionId, code) {
      // Never overwrite a good score with a failed re-run.
      const { data, error: readError } = await db
        .from("interview_evaluations")
        .select("status")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (readError) fail("check evaluation", readError);
      if (data?.status === "completed") return;
      const { error } = await db.from("interview_evaluations").upsert({
        session_id: sessionId,
        status: "failed",
        overall_score: null,
        recommendation: null,
        summary: "",
        strengths: [],
        concerns: [],
        criteria: [],
        error_code: code,
        updated_at: new Date().toISOString(),
      });
      if (error) fail("save failure", error);
    },
  };
}

/** Scores a session with the real database and LLM settings. Never throws. */
export async function evaluateSession(
  sessionId: string,
  options: { force?: boolean } = {},
): Promise<EvaluationOutcome> {
  try {
    const db = createAdminClient();
    return await runRubricEvaluation(
      { env: process.env, store: createSupabaseEvaluationStore(db), usage: createSupabaseUsageStore(db) },
      sessionId,
      options,
    );
  } catch {
    console.error("[evaluation] unexpected error");
    return { kind: "failed", code: "llm_failed" };
  }
}

export interface StoredEvaluation {
  status: "completed" | "failed";
  overallScore: number | null;
  recommendation: Recommendation | null;
  summary: string;
  strengths: string[];
  concerns: string[];
  criteria: CriterionScore[];
  errorCode: string | null;
  updatedAt: string;
}

/** Reads rows back into the shape the admin page renders. */
export function toStoredEvaluation(row: Database["public"]["Tables"]["interview_evaluations"]["Row"]): StoredEvaluation {
  return {
    status: row.status,
    overallScore: row.overall_score,
    recommendation: row.recommendation,
    summary: row.summary,
    strengths: row.strengths,
    concerns: row.concerns,
    criteria: Array.isArray(row.criteria) ? (row.criteria as unknown as CriterionScore[]) : [],
    errorCode: row.error_code,
    updatedAt: row.updated_at,
  };
}

export type { RubricEvaluation };
