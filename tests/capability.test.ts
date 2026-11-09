import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_AUDIENCE,
  CAPABILITY_TTL_SECONDS,
  issueCapability,
  SigningSecretError,
  verifyCapability,
} from "@/lib/interviews/capability";

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const USER = "11111111-2222-4333-8444-555555555555";
const NOW = 1_800_000_000_000;

function forge(payload: object, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret)
    .update(`v1.${body}`)
    .digest("base64url");
  return `v1.${body}.${sig}`;
}

describe("capability tokens", () => {
  it("round-trips a valid token", () => {
    const { token, payload } = issueCapability(USER, SECRET, { nowMs: NOW });
    const result = verifyCapability(token, SECRET, NOW + 1000);
    expect(result).toEqual({ ok: true, payload });
    expect(payload.sub).toBe(USER);
    expect(payload.aud).toBe(CAPABILITY_AUDIENCE);
    expect(payload.exp - payload.iat).toBe(CAPABILITY_TTL_SECONDS);
  });

  it("issues a unique jti per token", () => {
    const a = issueCapability(USER, SECRET, { nowMs: NOW }).payload.jti;
    const b = issueCapability(USER, SECRET, { nowMs: NOW }).payload.jti;
    expect(a).not.toBe(b);
  });

  it("refuses to issue or verify with a missing/short secret", () => {
    expect(() => issueCapability(USER, undefined)).toThrow(SigningSecretError);
    expect(() => issueCapability(USER, "short")).toThrow(SigningSecretError);
    expect(() => verifyCapability("x", undefined)).toThrow(SigningSecretError);
  });

  it("refuses to issue for a non-uuid subject", () => {
    expect(() => issueCapability("not-a-uuid", SECRET)).toThrow();
  });

  it("rejects tokens signed with a different secret", () => {
    const { token } = issueCapability(USER, `${SECRET}-other`, { nowMs: NOW });
    expect(verifyCapability(token, SECRET, NOW)).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("rejects a tampered payload (e.g. swapped user id)", () => {
    const { token } = issueCapability(USER, SECRET, { nowMs: NOW });
    const [v, body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.sub = "99999999-2222-4333-8444-555555555555";
    const tampered = `${v}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(verifyCapability(tampered, SECRET, NOW)).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("rejects expired tokens", () => {
    const { token } = issueCapability(USER, SECRET, { nowMs: NOW });
    const later = NOW + (CAPABILITY_TTL_SECONDS + 1) * 1000;
    expect(verifyCapability(token, SECRET, later)).toEqual({
      ok: false,
      code: "expired",
    });
  });

  it("rejects tokens issued in the future", () => {
    const { token } = issueCapability(USER, SECRET, { nowMs: NOW + 600_000 });
    expect(verifyCapability(token, SECRET, NOW)).toEqual({
      ok: false,
      code: "not_yet_valid",
    });
  });

  it("rejects missing and malformed tokens", () => {
    expect(verifyCapability(undefined, SECRET).ok).toBe(false);
    expect(verifyCapability("", SECRET)).toEqual({ ok: false, code: "missing" });
    expect(verifyCapability(123, SECRET)).toEqual({ ok: false, code: "missing" });
    expect(verifyCapability("a.b", SECRET)).toEqual({
      ok: false,
      code: "malformed",
    });
    expect(verifyCapability("v2.abc.def", SECRET)).toEqual({
      ok: false,
      code: "malformed",
    });
    expect(verifyCapability("v1.ab$c.def", SECRET)).toEqual({
      ok: false,
      code: "malformed",
    });
    expect(verifyCapability(`v1.${"a".repeat(2000)}.b`, SECRET)).toEqual({
      ok: false,
      code: "malformed",
    });
    // Liquid renders an undefined variable as an empty string.
    expect(verifyCapability("{{generationToken}}", SECRET).ok).toBe(false);
  });

  it("rejects correctly signed tokens with invalid claims", () => {
    const iat = Math.floor(NOW / 1000);
    const base = {
      v: 1,
      aud: CAPABILITY_AUDIENCE,
      sub: USER,
      jti: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      iat,
      exp: iat + 60,
    };
    expect(verifyCapability(forge(base), SECRET, NOW).ok).toBe(true);
    for (const bad of [
      { ...base, aud: "something-else" },
      { ...base, sub: "not-a-uuid" },
      { ...base, v: 2 },
      { ...base, exp: iat + 24 * 3600 }, // TTL above hard cap
      { ...base, extra: "field" },
    ]) {
      expect(verifyCapability(forge(bad), SECRET, NOW)).toEqual({
        ok: false,
        code: "invalid_claims",
      });
    }
  });
});
