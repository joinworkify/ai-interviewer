/**
 * MOCKED TESTS — NOT LIVE VERIFICATION.
 *
 * These tests inject an explicit fake `fetch` and never contact Google.
 * They only prove that, given the documented Gemini env values, our client
 * builds the expected OpenAI-compatible request and handles the documented
 * response shapes. They do NOT prove your key, quota, model, or region work.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LLM_BASE_URL,
  generateQuestions,
  readLlmConfig,
} from "@/lib/interviews/llm";
import type { GenerateInterviewInput } from "@/lib/interviews/validation";

const GEMINI_ENV = {
  LLM_API_KEY: "test-google-key-not-real",
  LLM_MODEL: "gemini-2.5-flash",
  LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const input: GenerateInterviewInput = {
  role: "Frontend Developer",
  level: "Junior",
  type: "technical",
  techstack: ["React", "TypeScript"],
  amount: 2,
};

function geminiConfig() {
  const r = readLlmConfig(GEMINI_ENV);
  if (!r.ok) throw new Error("Gemini example config should be valid");
  return r.config;
}

afterEach(() => vi.restoreAllMocks());

describe("Gemini OpenAI-compatible config (mocked fetch, not live)", () => {
  it("accepts the documented .env.example Gemini values", () => {
    expect(readLlmConfig(GEMINI_ENV)).toEqual({
      ok: true,
      config: {
        apiKey: "test-google-key-not-real",
        model: "gemini-2.5-flash",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        timeoutMs: 25_000,
      },
    });
  });

  it("does not change the runtime default for existing OpenAI users", () => {
    expect(DEFAULT_LLM_BASE_URL).toBe("https://api.openai.com/v1");
    const r = readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "some-openai-model" });
    expect(r).toMatchObject({
      ok: true,
      config: { baseUrl: "https://api.openai.com/v1", model: "some-openai-model" },
    });
  });

  it("sends POST to the Gemini endpoint with Bearer key and selected model", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: "mock",
            object: "chat.completion",
            model: "gemini-2.5-flash",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content:
                    '```json\n{"questions":["What is a React hook?","How do TypeScript generics help?"]}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const result = await generateQuestions(
      input,
      geminiConfig(),
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-google-key-not-real");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual([
      "system",
      "user",
    ]);

    expect(result).toEqual([
      "What is a React hook?",
      "How do TypeScript generics help?",
    ]);
  });

  it("maps a Gemini 429 (quota/rate limit) to rate_limited without leaking detail", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" } },
          ]),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );

    const err = await generateQuestions(
      input,
      geminiConfig(),
      fetchMock as unknown as typeof fetch,
    ).catch((e) => e);

    expect(err).toMatchObject({
      name: "LlmError",
      kind: "rate_limited",
      upstreamStatus: 429,
      message: "LLM provider returned HTTP 429.",
    });
    expect(String(err.message)).not.toContain("RESOURCE_EXHAUSTED");
    expect(logSpy).toHaveBeenCalledOnce();
  });
});
