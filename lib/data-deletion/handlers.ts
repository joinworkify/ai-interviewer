import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import type { DeletionStore } from "./store";
import { validateDeleteAccountBody } from "./validation";

/**
 * Framework-agnostic handlers (Request -> Response) for deleting a user's AI
 * interview data. Check order: auth -> id/body -> ownership -> delete. The
 * user id always comes from the verified session, never from the request.
 */

const MAX_BODY_BYTES = 1024;

export interface DeletionHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: DeletionStore;
  /** Best-effort cleanup once the account is gone (e.g. clear auth cookies). */
  afterAccountDeleted?: () => Promise<void>;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "storage_failed";

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

const unauthorized = () => fail(401, "unauthorized", "Sign in required.");
const notFound = () => fail(404, "not_found", "Not found.");
const storageFailed = () => fail(500, "storage_failed", "Could not delete the data.");

async function deleteOne(
  sessionId: string,
  deps: DeletionHandlerDeps,
  kind: "transcript" | "session",
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();
  if (!isUuid(sessionId)) return notFound();
  try {
    const done =
      kind === "transcript"
        ? await deps.store.deleteTranscript(userId, sessionId)
        : await deps.store.deleteSession(userId, sessionId);
    return done ? jsonResponse(200, { success: true, deleted: kind }) : notFound();
  } catch {
    return storageFailed();
  }
}

/** Removes the session's transcript and recording URL; the feedback stays. */
export function handleDeleteTranscript(
  sessionId: string,
  deps: DeletionHandlerDeps,
): Promise<Response> {
  return deleteOne(sessionId, deps, "transcript");
}

/** Removes the session; its feedback is deleted with it. */
export function handleDeleteSession(
  sessionId: string,
  deps: DeletionHandlerDeps,
): Promise<Response> {
  return deleteOne(sessionId, deps, "session");
}

/** Deletes the signed-in user's account and all data held for it. */
export async function handleDeleteAccount(
  request: Request,
  deps: DeletionHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();

  const body = await readJsonBody(request, MAX_BODY_BYTES, { allowEmpty: true });
  if (!body.ok) return fail(body.status, body.error, body.message);
  const parsed = validateDeleteAccountBody(body.value);
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Invalid request.", { details: parsed.errors });
  }

  try {
    await deps.store.deleteAccount(userId);
  } catch {
    return storageFailed();
  }

  // The data is gone; a cleanup failure must not turn this into an error.
  try {
    await deps.afterAccountDeleted?.();
  } catch {
    console.error("[deletion] post-delete cleanup failed");
  }
  return jsonResponse(200, { success: true, deleted: "account" });
}
