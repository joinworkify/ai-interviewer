import { describe, expect, it } from "vitest";
import {
  checkSameOrigin,
  parseAppOrigin,
  parseHostHeader,
} from "@/lib/gemini-live/origin";

/**
 * CSRF protection for POST /api/gemini-live/token (identity is still the
 * Supabase session). Regression: Next dev reports request.url as
 * http://localhost:3190 while the browser's Host/Origin is 127.0.0.1:3190.
 */

function req(
  url: string,
  headers: Record<string, string | undefined>,
): Request {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) h.set(k, v);
  return new Request(url, { method: "POST", headers: h });
}

const URL_LOCAL = "http://localhost:3190/api/gemini-live/token";

describe("parseHostHeader", () => {
  it.each([
    ["127.0.0.1:3190", "127.0.0.1:3190"],
    ["localhost:3190", "localhost:3190"],
    ["LOCALHOST:3190", "localhost:3190"],
    ["app.example.com", "app.example.com"],
    ["[::1]:3000", "[::1]:3000"],
  ])("accepts %s", (raw, host) => {
    expect(parseHostHeader(raw)).toBe(host);
  });

  it.each([
    null,
    "",
    " ",
    "evil.com/path",
    "evil.com?x",
    "user@evil.com",
    "a b",
    "host:99999",
    "host:",
    "host:12a",
    "evil.com, app.example.com",
    "http://evil.com",
    "-bad.com",
    "[::1",
    "x".repeat(300),
  ])("rejects malformed Host %j", (raw) => {
    expect(parseHostHeader(raw)).toBeNull();
  });
});

describe("parseAppOrigin (GEMINI_LIVE_APP_ORIGIN)", () => {
  it.each([
    ["https://app.example.com", "https://app.example.com"],
    ["https://app.example.com/", "https://app.example.com"],
    ["https://APP.example.com:443", "https://app.example.com"],
    ["http://127.0.0.1:3190", "http://127.0.0.1:3190"],
  ])("normalizes %s", (raw, origin) => {
    expect(parseAppOrigin(raw)).toBe(origin);
  });

  it.each([
    "app.example.com",
    "ftp://app.example.com",
    "https://app.example.com/path",
    "https://user:pw@app.example.com",
    "https://app.example.com?x=1",
    "https://app.example.com#f",
    "null",
    "*",
  ])("rejects %s", (raw) => {
    expect(parseAppOrigin(raw)).toBeNull();
  });
});

describe("checkSameOrigin", () => {
  it("accepts 127.0.0.1 browser Origin/Host when Next reports localhost in request.url", () => {
    const r = req(URL_LOCAL, {
      host: "127.0.0.1:3190",
      origin: "http://127.0.0.1:3190",
      "sec-fetch-site": "same-origin",
    });
    expect(checkSameOrigin(r, {})).toEqual({ ok: true });
  });

  it("accepts localhost when Host is localhost", () => {
    const r = req("http://127.0.0.1:3190/api/gemini-live/token", {
      host: "localhost:3190",
      origin: "http://localhost:3190",
    });
    expect(checkSameOrigin(r, {}).ok).toBe(true);
  });

  it("rejects Origin that differs from Host (localhost vs 127.0.0.1)", () => {
    const r = req(URL_LOCAL, { host: "127.0.0.1:3190", origin: "http://localhost:3190" });
    expect(checkSameOrigin(r, {}).ok).toBe(false);
  });

  it("rejects scheme or port mismatches", () => {
    expect(
      checkSameOrigin(req(URL_LOCAL, { host: "localhost:3190", origin: "https://localhost:3190" }), {}).ok,
    ).toBe(false);
    expect(
      checkSameOrigin(req(URL_LOCAL, { host: "localhost:3190", origin: "http://localhost:3191" }), {}).ok,
    ).toBe(false);
  });

  it("rejects foreign origins", () => {
    const r = req(URL_LOCAL, { host: "localhost:3190", origin: "https://evil.example" });
    expect(checkSameOrigin(r, {}).ok).toBe(false);
  });

  it("does not trust X-Forwarded-Host", () => {
    const r = req(URL_LOCAL, {
      host: "localhost:3190",
      origin: "https://evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });
    expect(checkSameOrigin(r, {}).ok).toBe(false);
  });

  it.each([
    ["missing Origin", { host: "localhost:3190" }],
    ['"null" Origin', { host: "localhost:3190", origin: "null" }],
    ["Origin with path", { host: "localhost:3190", origin: "http://localhost:3190/x" }],
    ["Origin with userinfo", { host: "localhost:3190", origin: "http://u@localhost:3190" }],
    ["non-http Origin", { host: "localhost:3190", origin: "javascript:alert(1)" }],
    ["malformed Host", { host: "localhost:3190/evil", origin: "http://localhost:3190" }],
    ["cross-site fetch metadata", { host: "localhost:3190", origin: "http://localhost:3190", "sec-fetch-site": "cross-site" }],
    ["same-site fetch metadata", { host: "localhost:3190", origin: "http://localhost:3190", "sec-fetch-site": "same-site" }],
  ])("rejects %s", (_label, headers) => {
    expect(checkSameOrigin(req(URL_LOCAL, headers), {}).ok).toBe(false);
  });

  it("falls back to the request URL authority only when Host is absent", () => {
    const r = req(URL_LOCAL, { origin: "http://localhost:3190" });
    r.headers.delete("host");
    expect(checkSameOrigin(r, {}).ok).toBe(true);
  });

  describe("with GEMINI_LIVE_APP_ORIGIN", () => {
    const env = { GEMINI_LIVE_APP_ORIGIN: "https://app.example.com" };

    it("uses the configured public origin and ignores the (internal) Host", () => {
      const r = req("http://10.0.0.5:3000/api/gemini-live/token", {
        host: "10.0.0.5:3000",
        origin: "https://app.example.com",
      });
      expect(checkSameOrigin(r, env)).toEqual({ ok: true });
    });

    it("rejects an Origin that only matches the Host", () => {
      const r = req("http://10.0.0.5:3000/api/gemini-live/token", {
        host: "10.0.0.5:3000",
        origin: "http://10.0.0.5:3000",
      });
      expect(checkSameOrigin(r, env).ok).toBe(false);
    });

    it("fails closed and flags misconfiguration when the value is invalid", () => {
      const r = req(URL_LOCAL, { host: "localhost:3190", origin: "http://localhost:3190" });
      expect(checkSameOrigin(r, { GEMINI_LIVE_APP_ORIGIN: "app.example.com/x" })).toEqual({
        ok: false,
        misconfigured: true,
      });
    });

    it("treats a blank value as unset", () => {
      const r = req(URL_LOCAL, { host: "localhost:3190", origin: "http://localhost:3190" });
      expect(checkSameOrigin(r, { GEMINI_LIVE_APP_ORIGIN: "  " }).ok).toBe(true);
    });
  });
});
