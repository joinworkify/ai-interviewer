import { getCaller } from "@/lib/admin/server";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse } from "@/lib/http/json";
import { reviewSessionAudio } from "@/lib/integrity/audio-review-server";
import { isUuid } from "@/lib/sessions/validation";

// Downloads the audio and waits for the model.
export const maxDuration = 120;

const MESSAGES: Record<string, string> = {
  session_not_found: "Interview not found.",
  no_recording: "This interview has no recording to review.",
  too_large: "The recording is too large to review.",
  not_configured: "Audio review needs GEMINI_API_KEY and a text model (LLM_MODEL or GEMINI_AUDIO_REVIEW_MODEL).",
  audio_failed: "The model could not review this audio. Try again.",
};

/** Admins only: run (or re-run) the audio review of one interview. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const caller = await getCaller();
  if (!caller) return jsonResponse(401, { success: false, error: "unauthorized", message: "Sign in required." });
  if (!caller.isAdmin) return jsonResponse(403, { success: false, error: "forbidden", message: "Admins only." });
  const { id } = await params;
  if (!isUuid(id)) return jsonResponse(400, { success: false, error: "invalid_request", message: "Invalid interview id." });

  const outcome = await reviewSessionAudio(id);
  if (outcome.kind === "reviewed") return jsonResponse(200, { success: true });
  const status = outcome.code === "session_not_found" ? 404 : outcome.code === "audio_failed" ? 502 : 422;
  return jsonResponse(status, { success: false, error: outcome.code, message: MESSAGES[outcome.code] ?? "Could not review." });
}
