import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SESSION_TOKEN_MAX_TTL_SECONDS,
  SESSION_TOKEN_TTL_SECONDS,
  SessionSecretError,
  issueSessionToken,
  verifySessionToken,
} from "@/lib/dograh/session-token";

import { OTHER_USER, SESSION, SESSION_SECRET, USER, makeToken } from "./helpers/dograh";

const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

function resign(payload: Record<string, unknown>, secret = SESSION_SECRET): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signed = `v1.${body}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

const goodPayload = () => ({
  v: 1,
  aud: "dograh-interview",
  sub: USER,
  sid: SESSION,
  jti: "33333333-3333-4333-8333-333333333333",
  iat: Math.floor(NOW / 1000),
  exp: Math.floor(NOW / 1000) + 600,
});

describe("session token", () => {
  it("round-trips the user and session", () => {
    const { token, payload } = issueSessionToken(USER, SESSION, SESSION_SECRET, { nowMs: NOW });
    expect(payload.exp - payload.iat).toBe(SESSION_TOKEN_TTL_SECONDS);
    const result = verifySessionToken(token, SESSION_SECRET, NOW + 1000);
    expect(result).toEqual({ ok: true, payload });
    if (result.ok) expect(result.payload).toMatchObject({ sub: USER, sid: SESSION });
  });

  it("rejects a token signed with another secret", () => {
    const token = makeToken({ nowMs: NOW });
    const result = verifySessionToken(token, "another-secret-0123456789-abcdefghijklmnopq", NOW);
    expect(result).toEqual({ ok: false, code: "bad_signature" });
  });

  it("rejects a tampered payload (swapped user) with the old signature", () => {
    const token = makeToken({ nowMs: NOW });
    const [v, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...goodPayload(), sub: OTHER_USER })).toString("base64url");
    expect(verifySessionToken(`${v}.${forged}.${sig}`, SESSION_SECRET, NOW)).toEqual({
      ok: false,
      code: "bad_signature",
    });
  });

  it("rejects an expired token and one not yet valid", () => {
    const token = makeToken({ nowMs: NOW, ttlSeconds: 60 });
    expect(verifySessionToken(token, SESSION_SECRET, NOW + 61_000)).toEqual({ ok: false, code: "expired" });
    expect(verifySessionToken(token, SESSION_SECRET, NOW - 120_000)).toEqual({
      ok: false,
      code: "not_yet_valid",
    });
  });

  it("rejects a wrong audience, a missing claim, an extra claim and a stretched TTL even when correctly signed", () => {
    const bad: Record<string, unknown>[] = [
      { ...goodPayload(), aud: "vapi-generate-interview" },
      (() => {
        const p: Record<string, unknown> = goodPayload();
        delete p.sid;
        return p;
      })(),
      { ...goodPayload(), role: "admin" },
      { ...goodPayload(), exp: goodPayload().iat + SESSION_TOKEN_MAX_TTL_SECONDS + 1 },
      { ...goodPayload(), sid: "not-a-uuid" },
    ];
    for (const payload of bad) {
      expect(verifySessionToken(resign(payload), SESSION_SECRET, NOW)).toEqual({
        ok: false,
        code: "invalid_claims",
      });
    }
  });

  it.each([undefined, null, "", 42, "a.b", "v2.x.y", `v1.${"a".repeat(2000)}.b`, "v1.!!!.???"])(
    "rejects a malformed token (%s)",
    (token) => {
      const result = verifySessionToken(token, SESSION_SECRET, NOW);
      expect(result.ok).toBe(false);
    },
  );

  it("refuses to issue or verify with a short secret", () => {
    expect(() => issueSessionToken(USER, SESSION, "short")).toThrow(SessionSecretError);
    expect(() => verifySessionToken(makeToken(), undefined)).toThrow(SessionSecretError);
  });

  it("refuses non-uuid subjects and a TTL over the cap", () => {
    expect(() => issueSessionToken("bob", SESSION, SESSION_SECRET)).toThrow();
    expect(() => issueSessionToken(USER, "x", SESSION_SECRET)).toThrow();
    expect(() =>
      issueSessionToken(USER, SESSION, SESSION_SECRET, { ttlSeconds: SESSION_TOKEN_MAX_TTL_SECONDS + 1 }),
    ).toThrow();
  });
});
