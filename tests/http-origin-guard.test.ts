import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guardSameOrigin } from "@/lib/http/origin-guard";

const URL_ = "https://app.example.test/api/sessions";

function post(headers: Record<string, string>) {
  return new Request(URL_, { method: "POST", headers });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("guardSameOrigin", () => {
  it("returns null for a same-origin request", () => {
    expect(guardSameOrigin(post({ origin: "https://app.example.test", host: "app.example.test" }), {})).toBeNull();
  });

  it("blocks a foreign origin with a no-store JSON 403", async () => {
    const res = guardSameOrigin(post({ origin: "https://evil.example", host: "app.example.test" }), {});
    expect(res?.status).toBe(403);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.json()).toEqual({
      success: false,
      error: "forbidden_origin",
      message: "Cross-origin request blocked.",
    });
  });

  it("blocks a request with no Origin (a plain cross-site form post)", () => {
    expect(guardSameOrigin(post({ host: "app.example.test" }), {})?.status).toBe(403);
  });

  it("answers 503 when APP_ORIGIN is invalid, without echoing it", async () => {
    const res = guardSameOrigin(
      post({ origin: "https://app.example.test", host: "app.example.test" }),
      { APP_ORIGIN: "javascript:alert(1)" },
    );
    expect(res?.status).toBe(503);
    expect(JSON.stringify(await res?.json())).not.toContain("javascript");
  });
});
