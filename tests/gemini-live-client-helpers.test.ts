import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeCloseEvent,
  describeMicError,
  TokenRequestError,
} from "@/lib/gemini-live/errors";
import { requestLiveToken } from "@/lib/gemini-live/token-client";

afterEach(() => vi.unstubAllGlobals());

describe("describeMicError", () => {
  it.each([
    ["NotAllowedError", /permission/i],
    ["SecurityError", /permission/i],
    ["NotFoundError", /no microphone/i],
    ["NotReadableError", /in use/i],
    ["MicUnavailableError", /HTTPS or localhost/],
    ["Weird", /could not start the microphone/i],
  ])("maps %s", (name, re) => {
    expect(describeMicError(Object.assign(new Error("x"), { name }))).toMatch(re);
  });
});

describe("describeCloseEvent", () => {
  it("includes the code and a truncated, token-free reason", () => {
    const msg = describeCloseEvent({
      code: 1008,
      reason: "Invalid auth_tokens/abcdef123 " + "x".repeat(500),
    });
    expect(msg).toMatch(/1008/);
    expect(msg).not.toContain("auth_tokens/abcdef123");
    expect(msg.length).toBeLessThan(300);
  });
});

describe("requestLiveToken", () => {
  const details = { role: "PM", level: "mid" as const, techstack: ["Jira"] };

  it("POSTs the details with no-store and returns the grant", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        token: "auth_tokens/t",
        model: "gemini-3.8-live",
        maxSessionSeconds: 300,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    await expect(requestLiveToken(details, signal)).resolves.toEqual({
      token: "auth_tokens/t",
      model: "gemini-3.8-live",
      maxSessionSeconds: 300,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gemini-live/token",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal,
        body: JSON.stringify(details),
      }),
    );
  });

  it("throws TokenRequestError with the server's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "gemini_not_configured", message: "Gemini Live is not configured." },
          { status: 503 },
        ),
      ),
    );
    await expect(requestLiveToken(details)).rejects.toMatchObject({
      name: "TokenRequestError",
      status: 503,
      message: "Gemini Live is not configured.",
    });
  });

  it("explains redirects to login / non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>login</html>", { status: 200 })),
    );
    await expect(requestLiveToken(details)).rejects.toThrow(/sign in/i);
  });

  it("rejects malformed grants", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "AIza-key", model: "m" })));
    await expect(requestLiveToken(details)).rejects.toBeInstanceOf(TokenRequestError);
  });

  it("wraps network errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(requestLiveToken(details)).rejects.toThrow(/reach the server/i);
  });
});
