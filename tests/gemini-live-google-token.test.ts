import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiAuthToken } from "@/lib/gemini-live/google-token";
import { buildEphemeralTokenConfig } from "@/lib/gemini-live/prompt";

/**
 * Exercises the real @google/genai SDK request serialization. Only the
 * network is replaced (global fetch stub); no live Google call is made and
 * the response below is a fixture, not a real token.
 */

const API_KEY = "AIzaSy-test-server-key";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createGeminiAuthToken (real SDK, stubbed network)", () => {
  it("POSTs a one-use constrained token request to v1beta auth_tokens", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ name: "auth_tokens/fixture" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const config = buildEphemeralTokenConfig({
      model: "gemini-3.8-live",
      details: { role: "QA Engineer", level: "junior", techstack: ["Playwright"] },
      now: Date.parse("2026-11-09T12:00:00.000Z"),
    });

    const token = await createGeminiAuthToken(API_KEY, config);
    expect(token.name).toBe("auth_tokens/fixture");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input instanceof Request ? input.url : input));
    expect(url.origin).toBe("https://generativelanguage.googleapis.com");
    expect(url.pathname).toBe("/v1beta/auth_tokens");
    // Key travels in a header, never in the URL.
    expect(url.search).not.toContain(API_KEY);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe(API_KEY);

    const body = JSON.parse(String(init?.body));
    expect(body.uses).toBe(1);
    expect(body.expireTime).toBe("2026-11-09T12:06:30.000Z");
    expect(body.newSessionExpireTime).toBe("2026-11-09T12:01:00.000Z");
    // No field mask -> the whole constrained setup is locked.
    expect(body).not.toHaveProperty("fieldMask");

    const setup = body.bidiGenerateContentSetup;
    expect(setup.model).toBe("models/gemini-3.8-live");
    expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.systemInstruction.parts[0].text).toContain('"QA Engineer"');
    expect(setup.tools[0].functionDeclarations[0].name).toBe("end_interview");
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
  });

  it("surfaces provider HTTP errors with a numeric status for sanitization", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ error: { code: 403, message: "denied", status: "PERMISSION_DENIED" } }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const config = buildEphemeralTokenConfig({
      model: "gemini-3.8-live",
      details: { role: "QA", level: "junior", techstack: ["x"] },
      now: Date.now(),
    });
    await expect(createGeminiAuthToken(API_KEY, config)).rejects.toMatchObject({
      status: 403,
    });
  });
});
