import { getCaller } from "@/lib/admin/server";
import { MAX_TRANSCRIPT_CHARS_CASE, parseHumanScores } from "@/lib/evaluation/calibration";
import { parseRubric, rubricOrDefault } from "@/lib/evaluation/rubric";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { normalizeTranscript } from "@/lib/sessions/transcript";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

const fail = (status: number, error: string, message: string) => jsonResponse(status, { success: false, error, message });

/** Admins only: add a calibration case (a transcript plus the scores a person gave it). */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const caller = await getCaller();
  if (!caller) return fail(401, "unauthorized", "Sign in required.");
  if (!caller.isAdmin) return fail(403, "forbidden", "Admins only.");

  const body = await readJsonBody(request, MAX_TRANSCRIPT_CHARS_CASE + 8192);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const v = (body.value ?? {}) as Record<string, unknown>;
  const title = typeof v.title === "string" ? v.title.trim() : "";
  const roleTitle = typeof v.roleTitle === "string" ? v.roleTitle.trim() : "";
  if (!title || title.length > 120 || !roleTitle || roleTitle.length > 120) return fail(400, "invalid_request", "Give the case a title and a role.");
  if (typeof v.transcript !== "string" || v.transcript.length > MAX_TRANSCRIPT_CHARS_CASE) {
    return fail(400, "invalid_request", "Paste the transcript as 'Interviewer: ...' and 'Candidate: ...' lines.");
  }
  const turns = normalizeTranscript(v.transcript);
  if (!turns.ok || !turns.turns.some((t) => t.role === "candidate")) {
    return fail(400, "invalid_request", "The transcript needs at least one 'Candidate:' line.");
  }
  const parsedRubric = parseRubric(v.rubric ?? []);
  if (!parsedRubric.ok) return fail(400, "invalid_request", parsedRubric.message);
  const rubric = rubricOrDefault(parsedRubric.rubric);
  const human = parseHumanScores(v.humanScores, rubric);
  if (!human.ok) return fail(400, "invalid_request", human.message);

  try {
    const { data, error } = await createAdminClient()
      .from("calibration_cases")
      .insert({
        title,
        role_title: roleTitle,
        rubric: rubric as unknown as Json,
        transcript: turns.turns.map((t) => ({ role: t.role, text: t.text })) as unknown as Json,
        human_scores: human.scores as unknown as Json,
        created_by: caller.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return jsonResponse(201, { success: true, id: data.id });
  } catch (err) {
    console.error("[calibration] create failed", describeError(err));
    return fail(500, "storage_failed", "Could not save the case.");
  }
}
