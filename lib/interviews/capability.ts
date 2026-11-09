import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, signed "generation capability" tokens.
 *
 * Flow:
 *  1. An authenticated user (Supabase session cookie) asks our server for a
 *     capability. The server takes the user id from the verified Supabase
 *     claims - never from the browser - and signs it with a server-only secret.
 *  2. The browser passes the opaque token to Vapi through
 *     `assistantOverrides.variableValues.generationToken`.
 *  3. The Vapi API Request tool sends it back as a static body field.
 *  4. The tool endpoint verifies signature, audience, expiry and shape, and
 *     uses the `sub` inside the token as the owner of the saved interview.
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`
 * The HMAC covers the literal string `v1.<payload>`.
 *
 * This module only uses `node:crypto` and must only be imported from
 * server code (route handlers / server components).
 */

export const CAPABILITY_VERSION = "v1";
export const CAPABILITY_AUDIENCE = "vapi-generate-interview";
/** Long enough for a normal generator call, short enough to limit replay. */
export const CAPABILITY_TTL_SECONDS = 15 * 60;
/** Hard upper bound accepted at verification time, regardless of `exp`. */
export const CAPABILITY_MAX_TTL_SECONDS = 60 * 60;
export const MIN_SIGNING_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 1024;
const CLOCK_SKEW_SECONDS = 30;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CapabilityPayload {
  v: 1;
  aud: typeof CAPABILITY_AUDIENCE;
  /** Supabase auth user id (uuid). */
  sub: string;
  /** Unique id of this capability; used as a single-use generation id. */
  jti: string;
  /** Issued at, unix seconds. */
  iat: number;
  /** Expires at, unix seconds. */
  exp: number;
}

export type CapabilityErrorCode =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "invalid_claims";

export type VerifyResult =
  | { ok: true; payload: CapabilityPayload }
  | { ok: false; code: CapabilityErrorCode };

export class SigningSecretError extends Error {}

export function assertSigningSecret(secret: string | undefined): string {
  if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new SigningSecretError(
      `VAPI_TOOL_SIGNING_SECRET must be set to a random string of at least ${MIN_SIGNING_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data, "utf8").digest();
}

export function issueCapability(
  userId: string,
  secret: string | undefined,
  options: { nowMs?: number; ttlSeconds?: number; jti?: string } = {},
): { token: string; payload: CapabilityPayload } {
  const key = assertSigningSecret(secret);
  if (!UUID_RE.test(userId)) {
    throw new Error("Capability subject must be a Supabase user id (uuid).");
  }
  const iat = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? CAPABILITY_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > CAPABILITY_MAX_TTL_SECONDS) {
    throw new Error("Invalid capability TTL.");
  }
  const payload: CapabilityPayload = {
    v: 1,
    aud: CAPABILITY_AUDIENCE,
    sub: userId,
    jti: options.jti ?? randomUUID(),
    iat,
    exp: iat + ttl,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signed = `${CAPABILITY_VERSION}.${body}`;
  const sig = sign(signed, key).toString("base64url");
  return { token: `${signed}.${sig}`, payload };
}

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export function verifyCapability(
  token: unknown,
  secret: string | undefined,
  nowMs: number = Date.now(),
): VerifyResult {
  const key = assertSigningSecret(secret);

  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, code: "missing" };
  }
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, code: "malformed" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== CAPABILITY_VERSION) {
    return { ok: false, code: "malformed" };
  }
  const [version, body, sig] = parts;
  if (!B64URL_RE.test(body) || !B64URL_RE.test(sig)) {
    return { ok: false, code: "malformed" };
  }

  // Verify the signature before parsing anything attacker-controlled.
  const expected = sign(`${version}.${body}`, key);
  const provided = Buffer.from(sig, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { ok: false, code: "bad_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, code: "malformed" };
  }

  if (!isCapabilityPayload(payload)) {
    return { ok: false, code: "invalid_claims" };
  }

  const now = Math.floor(nowMs / 1000);
  if (payload.exp - payload.iat > CAPABILITY_MAX_TTL_SECONDS) {
    return { ok: false, code: "invalid_claims" };
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    return { ok: false, code: "not_yet_valid" };
  }
  if (payload.exp <= now) return { ok: false, code: "expired" };

  return { ok: true, payload };
}

function isCapabilityPayload(value: unknown): value is CapabilityPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const keys = Object.keys(p).sort().join(",");
  return (
    keys === "aud,exp,iat,jti,sub,v" &&
    p.v === 1 &&
    p.aud === CAPABILITY_AUDIENCE &&
    typeof p.sub === "string" &&
    UUID_RE.test(p.sub) &&
    typeof p.jti === "string" &&
    UUID_RE.test(p.jti) &&
    Number.isSafeInteger(p.iat) &&
    Number.isSafeInteger(p.exp) &&
    (p.exp as number) > (p.iat as number)
  );
}
