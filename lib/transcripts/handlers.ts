import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { MAX_TRANSCRIPT_BODY_BYTES } from "./limits";
import type { TranscriptStore } from "./store";
import { validateTranscriptBody, type AdapterRegistry } from "./validation";

/**
 * PUT /api/sessions/:id/transcript. Framework-agnostic (Request -> Response)
 * with injected dependencies, like lib/sessions/handlers.ts.
 *
 * Check order: auth -> id -> body -> validation -> atomic write. Transcript
 * text is never logged.
 */

export interface TranscriptHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: TranscriptStore;
  adapters: AdapterRegistry;
  now?: () => number;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "transcript_already_stored"
  | "storage_failed";

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

export async function handlePutTranscript(
  request: Request,
  sessionId: string,
  deps: TranscriptHandlerDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to save a transcript.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Session not found.");

  const body = await readJsonBody(request, MAX_TRANSCRIPT_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);

  const parsed = validateTranscriptBody(body.value, deps.adapters);
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Invalid transcript.", { details: parsed.errors });
  }

  try {
    const outcome = await deps.store.storeOnce({
      sessionId,
      userId,
      transcript: parsed.data.transcript,
      metadata: parsed.data.metadata,
      endedAtIso: new Date(now()).toISOString(),
    });
    if (outcome.kind === "not_found") {
      return fail(404, "not_found", "Session not found.");
    }
    if (outcome.kind === "already_stored") {
      return fail(
        409,
        "transcript_already_stored",
        "This session already has a transcript.",
      );
    }
    return jsonResponse(200, {
      success: true,
      session: { id: sessionId, status: outcome.status },
      transcript: {
        source: parsed.data.metadata.source,
        entries: parsed.data.transcript.length,
      },
    });
  } catch {
    return fail(500, "storage_failed", "Could not save the transcript.");
  }
}
