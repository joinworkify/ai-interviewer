import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateAuthTokenConfig } from "@google/genai";
import {
  handleLiveTokenRequest,
  type LiveTokenDeps,
} from "@/lib/gemini-live/token-handler";
import { SlidingWindowLimiter } from "@/lib/gemini-live/rate-limit";
import { END_INTERVIEW_TOOL } from "@/lib/gemini-live/interview-details";

const API_KEY = "AIzaSy-SERVER-ONLY-SECRET-KEY-123";
const USER = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const URL_ = "https://app.example.com/api/gemini-live/token";
const ORIGIN = "https://app.example.com";
const BODY = { role: "Backend Engineer", level: "senior", techstack: "Go, PostgreSQL" };

const env = { GEMINI_API_KEY: API_KEY, GEMINI_LIVE_MODEL: "gemini-3.8-live" };

function req(
  body: unknown = BODY,
  headers: Record<string, string> = {},
): Request {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let createAuthToken: ReturnType<
  typeof vi.fn<(apiKey: string, config: CreateAuthTokenConfig) => Promise<{ name?: string }>>
>;
let authenticate: ReturnType<typeof vi.fn<LiveTokenDeps["authenticate"]>>;
let limiter: SlidingWindowLimiter;

function deps(overrides: Partial<LiveTokenDeps> = {}): LiveTokenDeps {
  return {
    env,
    authenticate,
    createAuthToken,
    limiter,
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  createAuthToken = vi.fn(async () => ({ name: "auth_tokens/abc123" }));
  authenticate = vi.fn(async () => ({ ok: true as const, userId: USER }));
  limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 600_000 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function json(res: Response) {
  const text = await res.text();
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}

describe("origin checks", () => {
  it.each([
    [{ origin: "https://evil.example" }],
    [{ origin: "http://app.example.com" }],
    [{ "sec-fetch-site": "cross-site" }],
    [{ "sec-fetch-site": "same-site" }],
  ])("rejects %j with 403 before auth", async (headers) => {
    const res = await handleLiveTokenRequest(req(BODY, headers), deps());
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error).toBe("forbidden_origin");
    expect(authenticate).not.toHaveBeenCalled();
    expect(createAuthToken).not.toHaveBeenCalled();
  });

  it("rejects requests without an Origin header", async () => {
    const r = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    });
    expect((await handleLiveTokenRequest(r, deps())).status).toBe(403);
  });

  it("issues a token when Next's request.url says localhost but the browser uses 127.0.0.1", async () => {
    const r = new Request("http://localhost:3190/api/gemini-live/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3190",
        origin: "http://127.0.0.1:3190",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify(BODY),
    });
    const res = await handleLiveTokenRequest(r, deps());
    expect(res.status).toBe(200);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("still requires a Supabase session after the origin check passes", async () => {
    authenticate.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const r = new Request("http://localhost:3190/api/gemini-live/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "127.0.0.1:3190",
        origin: "http://127.0.0.1:3190",
      },
      body: JSON.stringify(BODY),
    });
    expect((await handleLiveTokenRequest(r, deps())).status).toBe(401);
  });

  it("honours GEMINI_LIVE_APP_ORIGIN behind a proxy and logs invalid values", async () => {
    const behindProxy = (origin: string) =>
      new Request("http://10.0.0.5:3000/api/gemini-live/token", {
        method: "POST",
        headers: { "content-type": "application/json", host: "10.0.0.5:3000", origin },
        body: JSON.stringify(BODY),
      });
    const ok = await handleLiveTokenRequest(
      behindProxy("https://app.example.com"),
      deps({ env: { ...env, GEMINI_LIVE_APP_ORIGIN: "https://app.example.com" } }),
    );
    expect(ok.status).toBe(200);

    const bad = await handleLiveTokenRequest(
      behindProxy("https://app.example.com"),
      deps({ env: { ...env, GEMINI_LIVE_APP_ORIGIN: "not a url" } }),
    );
    expect(bad.status).toBe(403);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toMatch(/GEMINI_LIVE_APP_ORIGIN/);
  });
});

describe("auth", () => {
  it("returns 401 when signed out and never calls Google", async () => {
    authenticate.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(createAuthToken).not.toHaveBeenCalled();
  });

  it("returns 503 naming missing Supabase variables", async () => {
    authenticate.mockResolvedValue({
      ok: false,
      reason: "supabase_unconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_URL"],
    });
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: "server_misconfigured",
      missing: ["NEXT_PUBLIC_SUPABASE_URL"],
    });
  });
});

describe("Gemini setup", () => {
  it("returns a structured 503 when GEMINI_* is missing, without leaking values", async () => {
    const res = await handleLiveTokenRequest(
      req(),
      deps({ env: { GEMINI_API_KEY: "", GEMINI_LIVE_MODEL: "" } }),
    );
    expect(res.status).toBe(503);
    const { body } = await json(res);
    expect(body).toMatchObject({
      error: "gemini_not_configured",
      missing: ["GEMINI_API_KEY", "GEMINI_LIVE_MODEL"],
    });
    expect(body.message).toMatch(/GEMINI_LIVE_SETUP\.md/);
    expect(createAuthToken).not.toHaveBeenCalled();
  });

  it("rejects a text Flash model configured as the Live model", async () => {
    const res = await handleLiveTokenRequest(
      req(),
      deps({ env: { GEMINI_API_KEY: API_KEY, GEMINI_LIVE_MODEL: "gemini-2.5-flash" } }),
    );
    expect(res.status).toBe(503);
    const { text, body } = await json(res);
    expect(body.invalid).toEqual([expect.stringMatching(/^GEMINI_LIVE_MODEL/)]);
    expect(text).not.toContain(API_KEY);
  });
});

describe("request body", () => {
  it("returns 415 for non-JSON content types", async () => {
    const res = await handleLiveTokenRequest(
      req(BODY, { "content-type": "text/plain" }),
      deps(),
    );
    expect(res.status).toBe(415);
  });

  it("returns 413 for oversized bodies", async () => {
    const res = await handleLiveTokenRequest(
      req({ ...BODY, role: "x".repeat(5000) }),
      deps(),
    );
    expect(res.status).toBe(413);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await handleLiveTokenRequest(req("{nope"), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it.each([
    [{ ...BODY, role: "" }],
    [{ ...BODY, level: "wizard" }],
    [{ ...BODY, techstack: 7 }],
    [{ ...BODY, userId: "22222222-2222-4333-8444-555555555555" }],
  ])("returns 400 with details for malformed fields %j", async (body) => {
    const res = await handleLiveTokenRequest(req(body), deps());
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toBe("invalid_request");
    expect(Array.isArray(b.details)).toBe(true);
    expect(createAuthToken).not.toHaveBeenCalled();
  });
});

describe("throttle", () => {
  it("allows 3 tokens per user per window, then returns 429 with Retry-After", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await handleLiveTokenRequest(req(), deps())).status).toBe(200);
    }
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
    expect((await res.json()).error).toBe("rate_limited");
    expect(createAuthToken).toHaveBeenCalledTimes(3);

    // Keyed by the verified session user, not by anything the caller sends.
    authenticate.mockResolvedValue({ ok: true, userId: "other-user" });
    expect((await handleLiveTokenRequest(req(), deps())).status).toBe(200);
  });

  it("counts attempts whose provider call failed", async () => {
    createAuthToken.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    for (let i = 0; i < 3; i++) await handleLiveTokenRequest(req(), deps());
    expect((await handleLiveTokenRequest(req(), deps())).status).toBe(429);
  });
});

describe("token issuance", () => {
  it("requests a one-use, constrained, short-lived token with the server key", async () => {
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    expect(createAuthToken).toHaveBeenCalledTimes(1);
    const [key, config] = createAuthToken.mock.calls[0];
    expect(key).toBe(API_KEY);
    expect(config.uses).toBe(1);
    expect(config.newSessionExpireTime).toBe("2026-11-09T12:01:00.000Z");
    expect(config.expireTime).toBe("2026-11-09T12:06:30.000Z");
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    const c = config.liveConnectConstraints!;
    expect(c.model).toBe("gemini-3.8-live");
    expect(c.config!.responseModalities).toEqual(["AUDIO"]);
    expect(String(c.config!.systemInstruction)).toContain('"Backend Engineer"');
    expect(String(c.config!.systemInstruction)).toContain("Go, PostgreSQL");
    expect(JSON.stringify(c.config!.tools)).toContain(END_INTERVIEW_TOOL);

    const { text, body } = await json(res);
    expect(body).toEqual({
      token: "auth_tokens/abc123",
      model: "gemini-3.8-live",
      expiresAt: "2026-11-09T12:06:30.000Z",
      newSessionExpiresAt: "2026-11-09T12:01:00.000Z",
      maxSessionSeconds: 300,
    });
    expect(text).not.toContain(API_KEY);
  });

  it("never reads ownership from the body", async () => {
    // A valid body has no user field at all; the session user is used only
    // for throttling and is not forwarded to Google.
    await handleLiveTokenRequest(req(), deps());
    expect(JSON.stringify(createAuthToken.mock.calls[0][1])).not.toContain(USER);
  });
});

describe("provider failure sanitization", () => {
  const leaky = `API key ${API_KEY} not valid. Please pass a valid API key. projects/123`;

  it.each([
    [401, 502, "provider_auth_failed"],
    [403, 502, "provider_auth_failed"],
    [429, 503, "provider_rate_limited"],
    [500, 502, "provider_error"],
    [undefined, 502, "provider_error"],
  ])("maps provider status %s to %s %s without leaking details", async (status, http, code) => {
    createAuthToken.mockRejectedValue(Object.assign(new Error(leaky), { status }));
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(http);
    const { text, body } = await json(res);
    expect(body.error).toBe(code);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("projects/123");
    expect(text).not.toContain("not valid");
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(API_KEY);
  });

  it("returns 504 when the provider call times out", async () => {
    createAuthToken.mockImplementation(
      (_k, config) =>
        new Promise((_, reject) => {
          config.abortSignal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const res = await handleLiveTokenRequest(req(), deps({ timeoutMs: 5 }));
    expect(res.status).toBe(504);
    expect((await res.json()).error).toBe("provider_timeout");
  });

  it("returns 502 when Google returns no usable token name", async () => {
    createAuthToken.mockResolvedValue({ name: undefined });
    const res = await handleLiveTokenRequest(req(), deps());
    expect(res.status).toBe(502);
    createAuthToken.mockResolvedValue({ name: API_KEY });
    const res2 = await handleLiveTokenRequest(req(), deps());
    expect(res2.status).toBe(502);
    expect(await res2.text()).not.toContain(API_KEY);
  });
});
