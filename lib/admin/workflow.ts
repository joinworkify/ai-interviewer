import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { REVIEW_STATUSES, isReviewStatus } from "./access";
import type { ReviewHandlerDeps } from "./review";

/**
 * Admin workflow handlers (Request -> Response, injected dependencies):
 *   bulk review   POST /api/admin/sessions/bulk { ids, status, notify? }
 *   assign        POST /api/admin/sessions/:id/assign { adminId | null }
 *   notes         POST /api/admin/sessions/:id/notes { body }
 *                 DELETE ... { noteId }  (only the author's own note)
 * Check order everywhere: signed in -> admin -> id/body -> session exists -> write.
 */

type Caller = { userId: string; isAdmin: boolean } | null;
export const MAX_BULK = 50;
export const MAX_NOTE = 2000;
const MAX_BODY_BYTES = 8 * 1024;

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

function gate(caller: Caller): Response | null {
  if (!caller) return fail(401, "unauthorized", "Sign in required.");
  if (!caller.isAdmin) return fail(403, "forbidden", "Admins only.");
  return null;
}

export async function handleBulkReview(request: Request, deps: ReviewHandlerDeps): Promise<Response> {
  const caller = await deps.getCaller();
  const blocked = gate(caller);
  if (blocked) return blocked;
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const v = (body.value ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(v.ids) ? [...new Set(v.ids)] : [];
  if (ids.length === 0 || ids.length > MAX_BULK || !ids.every((id) => typeof id === "string" && isUuid(id))) {
    return fail(400, "invalid_request", `Choose 1-${MAX_BULK} interviews.`);
  }
  if (!isReviewStatus(v.status)) return fail(400, "invalid_request", `status must be one of: ${REVIEW_STATUSES.join(", ")}.`);
  const status = v.status;
  const notify = v.notify === true;

  let updated = 0;
  let missing = 0;
  try {
    for (const id of ids as string[]) {
      if (!(await deps.store.sessionExists(id))) {
        missing += 1;
        continue;
      }
      await deps.store.setStatus(id, status, caller!.userId);
      updated += 1;
      try {
        deps.onStatusSet?.({ sessionId: id, status, notify });
      } catch {
        console.error("[admin-bulk] status hook failed");
      }
    }
  } catch {
    return fail(500, "storage_failed", `Updated ${updated} before an error. Try the rest again.`);
  }
  return jsonResponse(200, { success: true, updated, missing });
}

export interface AssignStore {
  sessionExists(sessionId: string): Promise<boolean>;
  /** True when this user id is an admin account. */
  isAdminUser(userId: string): Promise<boolean>;
  setAssignee(sessionId: string, adminId: string | null): Promise<void>;
}

export interface NotesStore {
  sessionExists(sessionId: string): Promise<boolean>;
  authorName(userId: string): Promise<string>;
  add(args: { sessionId: string; authorId: string; authorName: string; body: string }): Promise<{ id: string; createdAt: string }>;
  /** Deletes the note only if the given admin wrote it; false otherwise. */
  removeOwn(noteId: string, authorId: string): Promise<boolean>;
}

export interface WorkflowDeps {
  getCaller: () => Promise<Caller>;
  assign: AssignStore;
  notes: NotesStore;
}

export async function handleAssign(request: Request, sessionId: string, deps: WorkflowDeps): Promise<Response> {
  const blocked = gate(await deps.getCaller());
  if (blocked) return blocked;
  if (!isUuid(sessionId)) return fail(400, "invalid_request", "Invalid interview id.");
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const adminId = (body.value as { adminId?: unknown } | null)?.adminId;
  if (adminId !== null && !(typeof adminId === "string" && isUuid(adminId))) {
    return fail(400, "invalid_request", "Choose a reviewer, or send null to unassign.");
  }
  try {
    if (!(await deps.assign.sessionExists(sessionId))) return fail(404, "not_found", "Interview not found.");
    if (adminId !== null && !(await deps.assign.isAdminUser(adminId))) {
      return fail(400, "invalid_request", "That person is not an admin.");
    }
    await deps.assign.setAssignee(sessionId, adminId);
    return jsonResponse(200, { success: true });
  } catch {
    return fail(500, "storage_failed", "Could not assign.");
  }
}

export async function handleNote(request: Request, sessionId: string, deps: WorkflowDeps): Promise<Response> {
  const caller = await deps.getCaller();
  const blocked = gate(caller);
  if (blocked) return blocked;
  if (!isUuid(sessionId)) return fail(400, "invalid_request", "Invalid interview id.");
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const v = (body.value ?? {}) as Record<string, unknown>;

  try {
    if (request.method === "DELETE") {
      if (typeof v.noteId !== "string" || !isUuid(v.noteId)) return fail(400, "invalid_request", "Invalid note.");
      return (await deps.notes.removeOwn(v.noteId, caller!.userId))
        ? jsonResponse(200, { success: true })
        : fail(404, "not_found", "You can only delete your own notes.");
    }
    const text = typeof v.body === "string" ? v.body.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
    if (!text) return fail(400, "invalid_request", "Write a note first.");
    if (text.length > MAX_NOTE) return fail(400, "invalid_request", `Notes are at most ${MAX_NOTE} characters.`);
    if (!(await deps.notes.sessionExists(sessionId))) return fail(404, "not_found", "Interview not found.");
    const note = await deps.notes.add({
      sessionId,
      authorId: caller!.userId,
      authorName: await deps.notes.authorName(caller!.userId),
      body: text,
    });
    return jsonResponse(201, { success: true, note });
  } catch {
    return fail(500, "storage_failed", "Could not save the note.");
  }
}
