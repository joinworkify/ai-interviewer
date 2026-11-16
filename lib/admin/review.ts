import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { REVIEW_STATUSES, isReviewStatus, type ReviewStatus } from "./access";

/**
 * `POST /api/admin/sessions/<id>/review { status }`: an admin sets the review
 * status of one interview attempt. Framework-agnostic (Request -> Response),
 * like lib/candidate/attempts.ts. Check order: signed in -> admin -> id/body ->
 * session exists -> write.
 */

const MAX_BODY_BYTES = 256;

export interface ReviewStore {
  sessionExists(sessionId: string): Promise<boolean>;
  setStatus(sessionId: string, status: ReviewStatus, adminId: string): Promise<{ updatedAt: string }>;
}

export interface ReviewHandlerDeps {
  /** The verified caller: null when signed out. */
  getCaller: () => Promise<{ userId: string; isAdmin: boolean } | null>;
  store: ReviewStore;
}

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export async function handleSetReviewStatus(
  request: Request,
  sessionId: string,
  deps: ReviewHandlerDeps,
): Promise<Response> {
  const caller = await deps.getCaller();
  if (!caller) return fail(401, "unauthorized", "Sign in required.");
  if (!caller.isAdmin) return fail(403, "forbidden", "Admins only.");

  if (!isUuid(sessionId)) return fail(400, "invalid_request", "Invalid interview id.");
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const status = (body.value as Record<string, unknown> | null)?.status;
  if (!isReviewStatus(status)) {
    return fail(400, "invalid_request", `status must be one of: ${REVIEW_STATUSES.join(", ")}.`);
  }

  try {
    if (!(await deps.store.sessionExists(sessionId))) return fail(404, "not_found", "Interview not found.");
    const { updatedAt } = await deps.store.setStatus(sessionId, status, caller.userId);
    return jsonResponse(200, { success: true, review: { sessionId, status, updatedAt } });
  } catch {
    return fail(500, "storage_failed", "Could not save the status.");
  }
}
