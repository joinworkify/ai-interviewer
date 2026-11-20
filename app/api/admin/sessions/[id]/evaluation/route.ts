import { getCaller } from "@/lib/admin/server";
import { evaluateSession } from "@/lib/evaluation/store";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

// Scoring calls the model (with a retry), which can take a while.
export const maxDuration = 60;

const MESSAGES: Record<string, string> = {
  session_not_found: "Interview not found.",
  no_transcript: "This interview has no transcript to score.",
  too_short: "The candidate said too little to score fairly.",
  llm_not_configured: "The scoring model is not configured on the server.",
  quota: "The daily model limit was reached.",
  llm_failed: "The scoring model could not score this interview. Try again.",
};

/** Admins only: score (or re-score) one interview against its role's rubric. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;

  const caller = await getCaller();
  if (!caller) return jsonResponse(401, { success: false, error: "unauthorized", message: "Sign in required." });
  if (!caller.isAdmin) return jsonResponse(403, { success: false, error: "forbidden", message: "Admins only." });

  const { id } = await params;
  if (!isUuid(id)) return jsonResponse(400, { success: false, error: "invalid_request", message: "Invalid interview id." });

  const outcome = await evaluateSession(id, { force: true });
  if (outcome.kind === "evaluated") {
    return jsonResponse(200, { success: true, overallScore: outcome.evaluation.overallScore });
  }
  const code = outcome.kind === "failed" ? outcome.code : "llm_failed";
  const status = code === "session_not_found" ? 404 : code === "llm_failed" ? 502 : 422;
  return jsonResponse(status, { success: false, error: code, message: MESSAGES[code] ?? "Could not score." });
}
