import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  calibrationReport,
  scoreDistribution,
  weightedOverall,
  type CalibrationCase,
} from "./calibration";
import { parseRubric } from "./rubric";

/** Everything the calibration page shows. Service-role reads: callers must have checked for an admin. */
export async function loadCalibration() {
  const db = createAdminClient();
  const [cases, runs, evaluations, consents] = await Promise.all([
    db.from("calibration_cases").select("*").order("created_at", { ascending: false }),
    db.from("calibration_runs").select("case_id, ai_scores, overall, created_at").order("created_at", { ascending: true }),
    db.from("interview_evaluations").select("session_id, overall_score").eq("status", "completed"),
    db.from("candidate_consents").select("session_id, role_id"),
  ]);
  for (const r of [cases, runs, evaluations, consents]) if (r.error) throw new Error("calibration load failed");
  const roleIds = [...new Set((consents.data ?? []).map((c) => c.role_id).filter(Boolean))];
  const roles = roleIds.length ? await db.from("roles").select("id, title").in("id", roleIds) : { data: [], error: null };
  const titleById = new Map((roles.data ?? []).map((r) => [r.id, r.title]));
  const roleBySession = new Map((consents.data ?? []).map((c) => [c.session_id, titleById.get(c.role_id) ?? c.role_id]));

  const runsByCase = new Map<string, { aiScores: Record<string, number | null>; overall: number; createdAt: string }[]>();
  for (const r of runs.data ?? []) {
    runsByCase.set(r.case_id, [...(runsByCase.get(r.case_id) ?? []), { aiScores: r.ai_scores as Record<string, number | null>, overall: r.overall, createdAt: r.created_at }]);
  }
  const prepared = (cases.data ?? []).map((c) => {
    const rubric = parseRubric(c.rubric);
    const human = c.human_scores as Record<string, number>;
    const rubricList = rubric.ok ? rubric.rubric : [];
    const caseRuns = runsByCase.get(c.id) ?? [];
    return { c, human, rubric: rubricList, runs: caseRuns, humanOverall: weightedOverall(human, rubricList) };
  });
  const report = calibrationReport(
    prepared.map((p): CalibrationCase => ({ humanScores: p.human, rubric: p.rubric, runs: p.runs })),
  );
  const distribution = scoreDistribution(
    (evaluations.data ?? []).flatMap((e) =>
      e.overall_score === null ? [] : [{ role: roleBySession.get(e.session_id) ?? "Unknown role", score: e.overall_score }],
    ),
  );

  return { report, distribution, prepared };
}
