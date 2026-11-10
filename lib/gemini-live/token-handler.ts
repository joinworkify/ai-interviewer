import type { CreateAuthTokenConfig } from "@google/genai";
import { readGeminiLiveConfig } from "./config";
import { MAX_SESSION_SECONDS, validateLiveInterviewBody } from "./interview-details";
import { checkSameOrigin } from "./origin";
import { buildEphemeralTokenConfig } from "./prompt";
import type { SlidingWindowLimiter } from "./rate-limit";

/**
 * `POST /api/gemini-live/token` — mints a one-use Gemini Live ephemeral token
 * for the signed-in user. Framework-agnostic (Request -> Response) with
 * injected auth/Google/limiter so it is unit-testable without network.
 *
 * Check order: origin -> session -> Gemini config -> body -> fields ->
 * throttle -> Google. Callers who fail early learn nothing about later steps.
 * The permanent GEMINI_API_KEY never leaves the server; provider errors are
 * logged as a status code only and returned as generic messages.
 */

export const MAX_BODY_BYTES = 2 * 1024;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
const TOKEN_NAME_RE = /^auth_tokens\/[A-Za-z0-9._-]{1,512}$/;

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "supabase_unconfigured"; missing: string[] };

export interface LiveTokenDeps {
  env: Record<string, string | undefined>;
  /** Verifies the Supabase session (claims) — the only source of identity. */
  authenticate: () => Promise<AuthResult>;
  /** Calls Google `authTokens.create` with the server API key. */
  createAuthToken: (
    apiKey: string,
    config: CreateAuthTokenConfig,
  ) => Promise<{ name?: string }>;
  limiter: SlidingWindowLimiter;
  now?: () => number;
  timeoutMs?: number;
}

function json(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function fail(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return json(status, { error, message, ...extra }, headers);
}

async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: fail(415, "unsupported_media_type", "Content-Type must be application/json."),
    };
  }
  const tooLarge = () => ({
    ok: false as const,
    response: fail(413, "payload_too_large", "Request body too large."),
  });
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return tooLarge();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return tooLarge();
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: fail(400, "invalid_json", "Request body must be valid JSON."),
    };
  }
}

function providerStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export async function handleLiveTokenRequest(
  request: Request,
  deps: LiveTokenDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  // 1. Cross-site (CSRF) protection — cookies would otherwise authorize a
  //    forged request. Not identity; see lib/gemini-live/origin.ts.
  const origin = checkSameOrigin(request, deps.env);
  if (!origin.ok) {
    if (origin.misconfigured) {
      console.error(
        "[gemini-live-token] GEMINI_LIVE_APP_ORIGIN is not a valid origin (e.g. https://app.example.com); rejecting requests",
      );
    }
    return fail(403, "forbidden_origin", "Cross-site requests are not allowed.");
  }

  // 2. Identity from verified Supabase claims only.
  const auth = await deps.authenticate();
  if (!auth.ok) {
    if (auth.reason === "supabase_unconfigured") {
      return fail(
        503,
        "server_misconfigured",
        `Supabase is not configured on the server. Set ${auth.missing.join(" and ")} (see .env.example).`,
        { missing: auth.missing },
      );
    }
    return fail(401, "unauthorized", "Sign in to start an interview.");
  }

  // 3. Gemini setup (names only, never values).
  const config = readGeminiLiveConfig(deps.env);
  if (!config.ok) {
    return fail(
      503,
      "gemini_not_configured",
      "Gemini Live is not configured on the server. Set the listed environment variables and restart (see GEMINI_LIVE_SETUP.md).",
      { missing: config.missing, invalid: config.invalid },
    );
  }

  // 4. Body + strict fields (no userId or config overrides accepted).
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const validation = validateLiveInterviewBody(body.value);
  if (!validation.ok) {
    return fail(400, "invalid_request", "Invalid interview details.", {
      details: validation.errors,
    });
  }

  // 5. Per-user, per-instance throttle (prototype; see rate-limit.ts).
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

  // 6. One-use constrained ephemeral token from Google.
  const tokenConfig = buildEphemeralTokenConfig({
    model: config.model,
    details: validation.data,
    now: issuedAt,
  });
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
  );
  let token: { name?: string };
  try {
    token = await deps.createAuthToken(config.apiKey, {
      ...tokenConfig,
      abortSignal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      console.error("[gemini-live-token] provider timeout");
      return fail(504, "provider_timeout", "Gemini did not respond in time. Please try again.");
    }
    const status = providerStatus(err);
    // Log only the status: SDK messages can echo request details.
    console.error(`[gemini-live-token] provider error status=${status ?? "unknown"}`);
    if (status === 401 || status === 403) {
      return fail(
        502,
        "provider_auth_failed",
        "Gemini rejected the server's credentials. Check GEMINI_API_KEY (see GEMINI_LIVE_SETUP.md).",
      );
    }
    if (status === 429) {
      return fail(
        503,
        "provider_rate_limited",
        "Gemini quota or rate limit reached. Please try again later.",
      );
    }
    return fail(502, "provider_error", "Could not create a Gemini Live session token.");
  } finally {
    clearTimeout(timer);
  }

  if (typeof token?.name !== "string" || !TOKEN_NAME_RE.test(token.name)) {
    console.error("[gemini-live-token] provider returned no usable token name");
    return fail(502, "provider_error", "Could not create a Gemini Live session token.");
  }

  return json(200, {
    token: token.name,
    model: config.model,
    expiresAt: tokenConfig.expireTime,
    newSessionExpiresAt: tokenConfig.newSessionExpireTime,
    maxSessionSeconds: MAX_SESSION_SECONDS,
  });
}
