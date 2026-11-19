import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { validateLiveInterviewBody } from "@/lib/gemini-live/interview-details";
import type { SlidingWindowLimiter } from "@/lib/gemini-live/rate-limit";
import type { SessionLinkLookup } from "@/lib/gemini-live/session-link";
import type { AuthResult } from "@/lib/gemini-live/token-handler";

import { readDograhConfig } from "./config";
import { buildContextVariables } from "./context";
import { SESSION_TOKEN_TTL_SECONDS, issueSessionToken } from "./session-token";

/**
 * `POST /api/dograh/session`: prepares one Dograh call for the signed-in user.
 * Framework-agnostic (Request -> Response) with injected dependencies.
 *
 * Check order: identity -> Dograh config -> body -> fields -> throttle ->
 * session ownership -> sign. The same-origin (CSRF) check runs in route.ts
 * first, like the /api/sessions routes. The user id comes only from the
 * verified Supabase claims; the body cannot carry one.
 */

export const MAX_SESSION_BODY_BYTES = 2 * 1024;

export interface DograhSessionDeps {
  env: Record<string, string | undefined>;
  authenticate: () => Promise<AuthResult>;
  /** Resolves the session to the user's own open interview, with its questions. */
  lookupSession: SessionLinkLookup;
  limiter: SlidingWindowLimiter;
  now?: () => number;
}

function fail(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra }, headers);
}

export async function handleDograhSession(
  request: Request,
  deps: DograhSessionDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  const auth = await deps.authenticate();
  if (!auth.ok) {
    if (auth.reason === "supabase_unconfigured") {
      return fail(503, "server_misconfigured", "Supabase is not configured on the server.", {
        missing: auth.missing,
      });
    }
    return fail(401, "unauthorized", "Sign in to start an interview.");
  }

  const config = readDograhConfig(deps.env);
  if (!config.ok) {
    return fail(
      503,
      "dograh_not_configured",
      "Dograh is not configured on the server. Set the listed environment variables and restart (see DOGRAH_SETUP.md).",
      { missing: config.missing, invalid: config.invalid },
    );
  }

  const body = await readJsonBody(request, MAX_SESSION_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const validation = validateLiveInterviewBody(body.value);
  if (!validation.ok) {
    return fail(400, "invalid_request", "Invalid interview details.", {
      details: validation.errors,
    });
  }
  const sessionId = validation.data.sessionId;
  if (!sessionId) return fail(400, "invalid_request", "sessionId is required.");

  const issuedAt = now();
  const limit = deps.limiter.hit(auth.userId, issuedAt);
  if (!limit.ok) {
    return fail(
      429,
      "rate_limited",
      `Too many interview sessions. Try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      { retryAfterSeconds: limit.retryAfterSeconds },
      { "retry-after": String(limit.retryAfterSeconds) },
    );
  }

  let linked;
  try {
    linked = await deps.lookupSession(auth.userId, sessionId);
  } catch {
    console.error("[dograh-session] session lookup failed");
    return fail(500, "storage_failed", "Could not load the interview session.");
  }
  if (linked.kind === "not_found") return fail(404, "not_found", "Interview session not found.");
  if (linked.kind === "closed") {
    return fail(409, "session_closed", "This interview session is already closed.");
  }

  const { token } = issueSessionToken(auth.userId, sessionId, config.sessionSecret, {
    nowMs: issuedAt,
  });
  return jsonResponse(200, {
    success: true,
    contextVariables: buildContextVariables({
      details: validation.data,
      questions: linked.questions,
      sessionToken: token,
    }),
    expiresAt: new Date(issuedAt + SESSION_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });
}
