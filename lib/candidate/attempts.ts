import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { normalizeTranscript } from "@/lib/sessions/transcript";
import { isUuid } from "@/lib/sessions/validation";

import { CONSENT_VERSION } from "./consent";
import roles from "./roles.json";

/**
 * `POST /api/candidate/attempts { roleId, consentVersion }`: starts one
 * interview attempt for the signed-in candidate. It creates an `interviews`
 * row holding the role's questions, an `interview_sessions` row for the
 * attempt and a `candidate_consents` row recording which consent wording the
 * candidate agreed to, and answers with the session id. Posting is the
 * agreement: without a current `consentVersion` no attempt is created. That id is what the Dograh call, the transcript webhook and
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

/** What the candidate agreed to when the attempt was created. */
export interface AttemptConsent {
  roleId: string;
  /** The wording shown (CONSENT_VERSION at the time). */
  version: string;
}

export interface AttemptStore {
  /**
   * Creates the interview, its first session and the consent record, all or
   * nothing; resolves with the session id.
   */
  createAttempt(
    userId: string,
    questions: string[],
    consent: AttemptConsent,
  ): Promise<{ sessionId: string }>;
}

/** The part of a session the candidate-facing status is derived from. */
export interface AttemptSession {
  user_id: string;
  status: string;
  transcript: unknown;
}

export interface AttemptHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: AttemptStore;
  /** Reads one session (the caller's own). Used by the status route only. */
  sessions: { getSession(sessionId: string): Promise<AttemptSession | null> };
}

/**
 * What a candidate is told about an attempt. Deliberately small: no transcript,
 * no feedback, no score, nothing a reviewer decides. The AI evaluation is for
 * reviewers; see lib/sessions/auto-evaluate.ts.
 *
 *  - processing: the transcript has not arrived yet
 *  - submitted:  a transcript with at least one spoken answer is stored
 *  - incomplete: the call produced no answer (or the session was abandoned)
 */
export type AttemptProgress = "processing" | "submitted" | "incomplete";

export function attemptProgress(session: Pick<AttemptSession, "status" | "transcript">): AttemptProgress {
  if (session.status === "abandoned") return "incomplete";
  if (session.transcript == null) return "processing";
  const transcript = normalizeTranscript(session.transcript);
  // Too large to evaluate still means the candidate spoke.
  if (!transcript.ok) return transcript.reason === "too_large" ? "submitted" : "incomplete";
  return transcript.turns.some((t) => t.role === "candidate" && t.text.length > 0)
    ? "submitted"
    : "incomplete";
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "consent_outdated"
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
  const unknown = Object.keys(value).filter((k) => k !== "roleId" && k !== "consentVersion");
  const { roleId, consentVersion } = value;
  if (
    unknown.length > 0 ||
    typeof roleId !== "string" ||
    roleId.length > 80 ||
    !ROLE_ID_RE.test(roleId) ||
    typeof consentVersion !== "string" ||
    consentVersion.length === 0 ||
    consentVersion.length > 40
  ) {
    return fail(400, "invalid_request", "Invalid request.", {
      details: [
        "Send only roleId (a role id such as software-engineer) and consentVersion (the version of the consent text shown).",
      ],
    });
  }

  const role = findRole(roleId);
  if (!role) return fail(404, "not_found", "This role is not available.");

  // A page opened before the wording changed must not record agreement to
  // text the candidate never saw.
  if (consentVersion !== CONSENT_VERSION) {
    return fail(
      409,
      "consent_outdated",
      "The consent text has changed. Reload the page and agree again.",
    );
  }

  try {
    const { sessionId } = await deps.store.createAttempt(userId, buildRoleQuestions(role), {
      roleId: role.id,
      version: consentVersion,
    });
    return jsonResponse(201, { success: true, attempt: { sessionId, roleId: role.id } });
  } catch {
    return fail(500, "storage_failed", "Could not start the interview.");
  }
}

/** GET /api/candidate/attempts/:id: the caller's own attempt, as a candidate-safe status. */
export async function handleGetAttempt(
  sessionId: string,
  deps: Pick<AttemptHandlerDeps, "getUserId" | "sessions">,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to see this interview.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Interview not found.");
  try {
    const session = await deps.sessions.getSession(sessionId);
    // Compared explicitly so a store on an RLS-bypassing client cannot leak rows.
    if (!session || session.user_id !== userId) {
      return fail(404, "not_found", "Interview not found.");
    }
    return jsonResponse(200, {
      success: true,
      attempt: { sessionId, status: attemptProgress(session) },
    });
  } catch {
    return fail(500, "storage_failed", "Could not load the interview.");
  }
}
