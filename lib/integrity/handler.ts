import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { MAX_EVENTS_PER_SESSION, parseIntegrityEvents, type IntegrityEvent } from "./events";

/**
 * POST /api/sessions/:id/integrity { events: [{ kind, atMs, durationMs? }] }.
 * The signed-in owner of a session reports what the browser saw. Capped per
 * request and per session so it cannot be used to fill the table. Framework
 * agnostic (Request -> Response) with injected dependencies.
 */

export interface IntegrityStore {
  ownsSession(userId: string, sessionId: string): Promise<boolean>;
  count(sessionId: string): Promise<number>;
  insert(sessionId: string, events: IntegrityEvent[]): Promise<void>;
}

export interface IntegrityHandlerDeps {
  getUserId: () => Promise<string | null>;
  store: IntegrityStore;
}

const MAX_BODY_BYTES = 8 * 1024;

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export async function handleReportIntegrity(
  request: Request,
  sessionId: string,
  deps: IntegrityHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Session not found.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const parsed = parseIntegrityEvents(body.value);
  if (!parsed.ok) return fail(400, "invalid_request", parsed.message);

  try {
    if (!(await deps.store.ownsSession(userId, sessionId))) return fail(404, "not_found", "Session not found.");
    const room = MAX_EVENTS_PER_SESSION - (await deps.store.count(sessionId));
    if (room <= 0) return jsonResponse(200, { success: true, stored: 0 });
    const events = parsed.events.slice(0, room);
    await deps.store.insert(sessionId, events);
    return jsonResponse(200, { success: true, stored: events.length });
  } catch {
    return fail(500, "storage_failed", "Could not save.");
  }
}
