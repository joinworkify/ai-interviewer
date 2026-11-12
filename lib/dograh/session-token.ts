import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { MIN_SIGNING_SECRET_LENGTH } from "@/lib/interviews/capability";

/**
 * Short-lived, signed token that ties one Dograh call to one interview
 * session and one user.
 *
 *  1. A signed-in user asks POST /api/dograh/session for a call. The server
 *     checks the session belongs to that user (identity comes from the verified
 *     Supabase claims, never from the body) and signs { sub, sid }.
 *  2. The browser hands the token to the Dograh widget as call context.
 *  3. When the call ends, the Dograh webhook sends the token back. The webhook
 *     route trusts only the signed `sub` and `sid`, never any other field.
 *
 * The browser can change widget context, so everything except this token is
 * treated as untrusted. A user can only replay a token for their own session,
 * and the transcript write is set-once.
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`, same as
 * lib/interviews/capability.ts but with its own audience and a session claim.
 * Server-only (node:crypto).
 */

export const SESSION_TOKEN_VERSION = "v1";
export const SESSION_TOKEN_AUDIENCE = "dograh-interview";
export const SESSION_TOKEN_TTL_SECONDS = 15 * 60;
/** Hard upper bound accepted at verification time, whatever `exp` says. */
export const SESSION_TOKEN_MAX_TTL_SECONDS = 60 * 60;
const MAX_TOKEN_LENGTH = 1024;
const CLOCK_SKEW_SECONDS = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface SessionTokenPayload {
  v: 1;
  aud: typeof SESSION_TOKEN_AUDIENCE;
  /** Supabase user id. */
  sub: string;
  /** interview_sessions.id the transcript belongs to. */
  sid: string;
  jti: string;
  iat: number;
  exp: number;
}

export type SessionTokenErrorCode =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "invalid_claims";

export type VerifySessionTokenResult =
  | { ok: true; payload: SessionTokenPayload }
  | { ok: false; code: SessionTokenErrorCode };

export class SessionSecretError extends Error {}

function assertSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new SessionSecretError(
      `DOGRAH_SESSION_SIGNING_SECRET must be at least ${MIN_SIGNING_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data, "utf8").digest();
}

export function issueSessionToken(
  userId: string,
  sessionId: string,
  secret: string | undefined,
  options: { nowMs?: number; ttlSeconds?: number; jti?: string } = {},
): { token: string; payload: SessionTokenPayload } {
  const key = assertSecret(secret);
  if (!UUID_RE.test(userId) || !UUID_RE.test(sessionId)) {
    throw new Error("Session token subject and session must be uuids.");
  }
  const iat = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? SESSION_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > SESSION_TOKEN_MAX_TTL_SECONDS) {
    throw new Error("Invalid session token TTL.");
  }
  const payload: SessionTokenPayload = {
    v: 1,
    aud: SESSION_TOKEN_AUDIENCE,
    sub: userId,
    sid: sessionId,
    jti: options.jti ?? randomUUID(),
    iat,
    exp: iat + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `${SESSION_TOKEN_VERSION}.${body}`;
  return { token: `${signed}.${sign(signed, key).toString("base64url")}`, payload };
}

export function verifySessionToken(
  token: unknown,
  secret: string | undefined,
  nowMs: number = Date.now(),
): VerifySessionTokenResult {
  const key = assertSecret(secret);

  if (typeof token !== "string" || token.length === 0) return { ok: false, code: "missing" };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, code: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_VERSION) {
    return { ok: false, code: "malformed" };
  }
  const [version, body, sig] = parts;
  if (!B64URL_RE.test(body) || !B64URL_RE.test(sig)) return { ok: false, code: "malformed" };

  // Verify the signature before parsing anything the caller controls.
  const expected = sign(`${version}.${body}`, key);
  const provided = Buffer.from(sig, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, code: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (!isPayload(payload)) return { ok: false, code: "invalid_claims" };

  const now = Math.floor(nowMs / 1000);
  if (payload.exp - payload.iat > SESSION_TOKEN_MAX_TTL_SECONDS) {
    return { ok: false, code: "invalid_claims" };
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) return { ok: false, code: "not_yet_valid" };
  if (payload.exp <= now) return { ok: false, code: "expired" };
  return { ok: true, payload };
}

function isPayload(value: unknown): value is SessionTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    Object.keys(p).sort().join(",") === "aud,exp,iat,jti,sid,sub,v" &&
    p.v === 1 &&
    p.aud === SESSION_TOKEN_AUDIENCE &&
    typeof p.sub === "string" &&
    UUID_RE.test(p.sub) &&
    typeof p.sid === "string" &&
    UUID_RE.test(p.sid) &&
    typeof p.jti === "string" &&
    UUID_RE.test(p.jti) &&
    Number.isSafeInteger(p.iat) &&
    Number.isSafeInteger(p.exp) &&
    (p.exp as number) > (p.iat as number)
  );
}
