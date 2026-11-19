import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { parseOverrideBody } from "./overrides";

/**
 * POST   /api/admin/sessions/:id/overrides { criterion, score, reason }: set or change
 * DELETE /api/admin/sessions/:id/overrides { criterion }: remove, back to the AI score
 * Admins only. The criterion must be one of the criteria the AI actually
 * scored for this interview (so the rubric can change later without breaking
 * old overrides), and a reason is required: an override with no reason is not
 * accepted.
 */

export interface OverrideStore {
  /** Names of the criteria scored for this session; null when it has no completed score. */
  criterionNames(sessionId: string): Promise<string[] | null>;
  set(args: { sessionId: string; criterion: string; score: number; reason: string; adminId: string }): Promise<void>;
  remove(sessionId: string, criterion: string): Promise<void>;
}

export interface OverrideHandlerDeps {
  getCaller: () => Promise<{ userId: string; isAdmin: boolean } | null>;
  store: OverrideStore;
}

const MAX_BODY_BYTES = 2048;

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export async function handleOverride(
  request: Request,
  sessionId: string,
  deps: OverrideHandlerDeps,
): Promise<Response> {
  const caller = await deps.getCaller();
  if (!caller) return fail(401, "unauthorized", "Sign in required.");
  if (!caller.isAdmin) return fail(403, "forbidden", "Admins only.");
  if (!isUuid(sessionId)) return fail(400, "invalid_request", "Invalid interview id.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);

  try {
    const names = await deps.store.criterionNames(sessionId);
    if (!names) return fail(404, "not_found", "This interview has no AI score to override.");

    if (request.method === "DELETE") {
      const criterion = (body.value as { criterion?: unknown } | null)?.criterion;
      const match = typeof criterion === "string" ? names.find((n) => n.toLowerCase() === criterion.trim().toLowerCase()) : undefined;
      if (!match) return fail(400, "invalid_request", "Unknown criterion.");
      await deps.store.remove(sessionId, match);
      return jsonResponse(200, { success: true });
    }

    const parsed = parseOverrideBody(body.value);
    if (!parsed.ok) return fail(400, "invalid_request", parsed.message);
    const match = names.find((n) => n.toLowerCase() === parsed.criterion.toLowerCase());
    if (!match) return fail(400, "invalid_request", "Unknown criterion.");
    await deps.store.set({ sessionId, criterion: match, score: parsed.score, reason: parsed.reason, adminId: caller.userId });
    return jsonResponse(200, { success: true });
  } catch {
    return fail(500, "storage_failed", "Could not save the override.");
  }
}
