import { jsonResponse, readJsonBody } from "@/lib/http/json";

import roles from "./roles.json";

/**
 * `POST /api/candidate/attempts { roleId }`: starts one interview attempt for
 * the signed-in candidate. It creates an `interviews` row holding the role's
 * questions and an `interview_sessions` row for the attempt, and answers with
 * the session id. That id is what the Dograh call, the transcript webhook and
 * the feedback route all hang off.
 *
 * Framework-agnostic (Request -> Response) with injected dependencies, like
 * lib/sessions/handlers.ts. The same-origin check runs in the route file first.
 * The user id comes only from verified Supabase claims, never from the body.
 *
 * Questions come from lib/candidate/roles.json (the same file that seeds
 * public.roles), so the server never trusts the browser for them.
 */

export const MAX_ATTEMPT_BODY_BYTES = 1024;
/** One intro question plus up to four about the role's requirements: about 5 minutes. */
export const MAX_ATTEMPT_QUESTIONS = 5;
export const ATTEMPT_DURATION_MINUTES = 5;

const ROLE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface RoleData {
  id: string;
  title: string;
  requirements: { title: string; text: string }[];
}

export function findRole(id: string): RoleData | undefined {
  return (roles as RoleData[]).find((r) => r.id === id);
}

/** Intro question, then one question per requirement (by its short title). */
export function buildRoleQuestions(role: Pick<RoleData, "title" | "requirements">): string[] {
  const questions = [
    `Please introduce yourself and tell me why you are interested in the ${role.title} role.`,
  ];
  for (const req of role.requirements) {
    if (questions.length >= MAX_ATTEMPT_QUESTIONS) break;
    questions.push(
      `Tell me about your experience with ${req.title.toLowerCase()}. Please share a specific example from your own work.`,
    );
  }
  return questions;
}

export interface AttemptStore {
  /** Creates the interview and its first session; resolves with the session id. */
  createAttempt(userId: string, questions: string[]): Promise<{ sessionId: string }>;
}

export interface AttemptHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: AttemptStore;
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

export async function handleStartAttempt(
  request: Request,
  deps: AttemptHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to start an interview.");

  const body = await readJsonBody(request, MAX_ATTEMPT_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);

  const value = body.value as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(400, "invalid_request", "Request body must be a JSON object.");
  }
  const unknown = Object.keys(value).filter((k) => k !== "roleId");
  const roleId = value.roleId;
  if (
    unknown.length > 0 ||
    typeof roleId !== "string" ||
    roleId.length > 80 ||
    !ROLE_ID_RE.test(roleId)
  ) {
    return fail(400, "invalid_request", "Invalid request.", {
      details: ["Send only roleId, a role id such as software-engineer."],
    });
  }

  const role = findRole(roleId);
  if (!role) return fail(404, "not_found", "This role is not available.");

  try {
    const { sessionId } = await deps.store.createAttempt(userId, buildRoleQuestions(role));
    return jsonResponse(201, { success: true, attempt: { sessionId, roleId: role.id } });
  } catch {
    return fail(500, "storage_failed", "Could not start the interview.");
  }
}
