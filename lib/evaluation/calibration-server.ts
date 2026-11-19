import "server-only";

import { readLlmConfig } from "@/lib/ai/client";
import { chatJson } from "@/lib/ai/json";
import { normalizeTranscript } from "@/lib/sessions/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

import { buildEvaluationMessages, parseEvaluation } from "./evaluate";
import { parseRubric } from "./rubric";

/** Scores one calibration case with the live model and saves the run. Throws on failure (the route reports it). */
export async function runCalibrationCase(caseId: string): Promise<{ overall: number }> {
  const db = createAdminClient();
  const { data: c, error } = await db.from("calibration_cases").select("*").eq("id", caseId).maybeSingle();
  if (error || !c) throw new Error("case not found");
  const rubric = parseRubric(c.rubric);
  const transcript = normalizeTranscript(c.transcript);
  if (!rubric.ok || rubric.rubric.length === 0 || !transcript.ok) throw new Error("case unreadable");
  const llm = readLlmConfig(process.env);
  if (!llm.ok) throw new Error("llm not configured");

  const { data } = await chatJson(
    llm.config,
    buildEvaluationMessages({ roleTitle: c.role_title, rubric: rubric.rubric, turns: transcript.turns }),
    (parsed) => parseEvaluation(parsed, rubric.rubric),
    { retries: 1, repairAttempts: 1, logTag: "calibration" },
  );
  const aiScores = Object.fromEntries(data.criteria.map((k) => [k.name, k.score]));
  const { error: saveError } = await db
    .from("calibration_runs")
    .insert({ case_id: caseId, ai_scores: aiScores as unknown as Json, overall: data.overallScore });
  if (saveError) throw new Error("save run failed");
  return { overall: data.overallScore };
}
