import { describe, expect, it } from "vitest";

import { checkSameOrigin } from "@/lib/http/origin";
import { checkSameOrigin as checkGeminiOrigin } from "@/lib/gemini-live/origin";

/**
 * Core same-origin check. The detailed Host/Origin parsing cases live in
 * gemini-live-origin.test.ts (they run through the re-export); these cover what
 * the move added: a provider-neutral env key.
 */

function req(headers: Record<string, string>, url = "https://app.example.test/api/sessions") {
  return new Request(url, { method: "POST", headers });
}

describe("lib/http/origin", () => {
  it("accepts a same-origin request", () => {
    expect(checkSameOrigin(req({ origin: "https://app.example.test", host: "app.example.test" }), {})).toEqual({ ok: true });
  });

  it("rejects a foreign Origin, a missing Origin and cross-site fetch metadata", () => {
    expect(checkSameOrigin(req({ origin: "https://evil.example", host: "app.example.test" }), {})).toEqual({ ok: false });
    expect(checkSameOrigin(req({ host: "app.example.test" }), {})).toEqual({ ok: false });
    expect(
      checkSameOrigin(
        req({ origin: "https://app.example.test", host: "app.example.test", "sec-fetch-site": "cross-site" }),
        {},
      ),
    ).toEqual({ ok: false });
  });

  it("uses APP_ORIGIN by default and fails closed when it is invalid", () => {
    const headers = { origin: "https://public.example.test", host: "internal:3000" };
    expect(checkSameOrigin(req(headers, "http://internal:3000/x"), { APP_ORIGIN: "https://public.example.test" })).toEqual({ ok: true });
    expect(checkSameOrigin(req(headers), { APP_ORIGIN: "not a url" })).toEqual({ ok: false, misconfigured: true });
  });

  it("does not read the Gemini-specific variable", () => {
    const headers = { origin: "https://public.example.test", host: "internal:3000" };
    expect(
      checkSameOrigin(req(headers, "http://internal:3000/x"), { GEMINI_LIVE_APP_ORIGIN: "https://public.example.test" }),
    ).toEqual({ ok: false });
  });

  it("keeps the Gemini wrapper on GEMINI_LIVE_APP_ORIGIN only", () => {
    const headers = { origin: "https://public.example.test", host: "internal:3000" };
    const url = "http://internal:3000/x";
    expect(checkGeminiOrigin(req(headers, url), { GEMINI_LIVE_APP_ORIGIN: "https://public.example.test" })).toEqual({ ok: true });
    expect(checkGeminiOrigin(req(headers, url), { APP_ORIGIN: "https://public.example.test" })).toEqual({ ok: false });
  });
});
