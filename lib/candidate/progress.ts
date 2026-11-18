import { jsonResponse } from "@/lib/http/json";

import { ROLE_ID_RE, STALE_ATTEMPT_MINUTES } from "./attempts";
import type { Progress } from "./steps";

/**
 * GET /api/candidate/progress?role=<roleId>: where the signed-in candidate is
 * in the application for one role, so the step pages can send them back when
 * they open a step out of order. Framework-agnostic (Request -> Response) with
 * injected dependencies, like lib/candidate/profile.ts. The user id comes only
 * from verified Supabase claims.
 *
 * Deliberately small: a flag and one attempt id. No transcript, score or
 * feedback.
 */

export interface ProgressStore {
  /**
   * The user's latest attempt for the role when it is still open: `in_progress`,
   * no transcript, and begun at or after `cutoff`. Otherwise null.
   */
  findOpenAttempt(userId: string, roleId: string, cutoff: Date): Promise<{ id: string } | null>;
  /** Whether the user has an uploaded resume. */
  hasUploadedResume(userId: string): Promise<boolean>;
}

export interface ProgressHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: ProgressStore;
  now?: () => Date;
}

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export async function handleGetProgress(
  request: Request,
  deps: ProgressHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to continue your application.");

  const roleId = new URL(request.url).searchParams.get("role") ?? "";
  if (roleId.length > 80 || !ROLE_ID_RE.test(roleId)) {
    return fail(400, "invalid_request", "Send role, a role id such as software-engineer.");
  }

  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000);
  try {
    const [attempt, uploaded] = await Promise.all([
      deps.store.findOpenAttempt(userId, roleId, cutoff),
      deps.store.hasUploadedResume(userId),
    ]);
    const progress: Progress = {
      roleId,
      resume: { uploaded },
      attempt: attempt ? { id: attempt.id } : null,
    };
    return jsonResponse(200, { success: true, progress });
  } catch {
    return fail(500, "storage_failed", "Could not load your progress.");
  }
}
