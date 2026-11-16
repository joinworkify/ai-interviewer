import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat, llmConfigWarnings, LlmError, readLlmConfig, type LlmConfig } from "@/lib/ai/client";

const config: LlmConfig = {
  apiKey: "k",
  model: "m",
  baseUrl: "https://llm.example/v1",
  timeoutMs: 5000,
};
const messages = [{ role: "user" as const, content: "hi" }];

function ok(content: unknown = "hello", usage?: object) {
  return new Response(
    JSON.stringify({
      model: "served-model",
      choices: [{ message: { content } }],
      usage,
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("chat", () => {
  it("returns content, served model and token usage", async () => {
    const fetchMock = vi.fn(async () =>
      ok("hello", { prompt_tokens: 12, completion_tokens: 3 }),
    );
    const res = await chat(config, messages, { fetch: fetchMock as typeof fetch });
    expect(res).toEqual({
      content: "hello",
      model: "served-model",
      usage: { promptTokens: 12, completionTokens: 3 },
    });
  });

  it("reports unknown usage as null instead of guessing", async () => {
    const res = await chat(config, messages, {
      fetch: (async () => ok("x", { prompt_tokens: "many" })) as typeof fetch,
    });
    expect(res.usage).toEqual({ promptTokens: null, completionTokens: null });
  });

  it("does not retry by default", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 429 }));
    await expect(
      chat(config, messages, { fetch: fetchMock as typeof fetch }),
    ).rejects.toMatchObject({ kind: "rate_limited" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(ok("finally"));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const res = await chat(config, messages, {
      fetch: fetchMock as unknown as typeof fetch,
      retries: 2,
      sleep,
    });
    expect(res.content).toBe("finally");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it("honours Retry-After, capped at 5s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 429, headers: { "retry-after": "60" } }),
      )
      .mockResolvedValueOnce(ok());
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    await chat(config, messages, {
      fetch: fetchMock as unknown as typeof fetch,
      retries: 1,
      sleep,
    });
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("gives up after the retry budget and surfaces the last error", async () => {
    const fetchMock = vi.fn(async () => new Response("busy", { status: 429 }));
    await expect(
      chat(config, messages, {
        fetch: fetchMock as typeof fetch,
        retries: 2,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ kind: "rate_limited", upstreamStatus: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 400, 404])("never retries HTTP %i", async (status) => {
    const fetchMock = vi.fn(async () => new Response("no", { status }));
    await expect(
      chat(config, messages, {
        fetch: fetchMock as typeof fetch,
        retries: 3,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a timeout", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      chat(config, messages, {
        fetch: fetchMock as unknown as typeof fetch,
        retries: 3,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok("back"));
    const res = await chat(config, messages, {
      fetch: fetchMock as unknown as typeof fetch,
      retries: 1,
      sleep: async () => {},
    });
    expect(res.content).toBe("back");
  });

  it("does not leak upstream error bodies into the thrown error", async () => {
    const fetchMock = vi.fn(
      async () => new Response("secret-detail-from-provider", { status: 500 }),
    );
    const err = await chat(config, messages, {
      fetch: fetchMock as typeof fetch,
    }).then(
      () => null,
      (e: LlmError) => e,
    );
    expect(err).toBeInstanceOf(LlmError);
    expect(err?.message).not.toContain("secret-detail");
  });
});

describe("llmConfigWarnings", () => {
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";

  it("is quiet for the settings that work", () => {
    expect(llmConfigWarnings({ model: "gemini-3.1-flash-lite", baseUrl: GEMINI })).toEqual([]);
    expect(llmConfigWarnings({ model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" })).toEqual([]);
  });

  it("warns when LLM_MODEL is a live (realtime) model", () => {
    const [w] = llmConfigWarnings({ model: "gemini-3.8-live", baseUrl: GEMINI });
    expect(w).toContain("LLM_MODEL");
    expect(w).toContain("GEMINI_LIVE_MODEL");
  });

  it("warns when the Gemini base URL lacks /v1beta/openai", () => {
    const [w] = llmConfigWarnings({ model: "gemini-3.1-flash-lite", baseUrl: "https://generativelanguage.googleapis.com" });
    expect(w).toContain("LLM_BASE_URL");
    expect(w).toContain("/v1beta/openai");
  });

  it("does not warn for a Gemini URL with a trailing slash removed by readLlmConfig", () => {
    expect(llmConfigWarnings({ model: "m", baseUrl: `${GEMINI}/` })).toEqual([]);
  });
});

describe("readLlmConfig warnings", () => {
  it("logs a suspicious setting once, never the key, and still accepts the config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      LLM_API_KEY: "secret-key-do-not-log",
      LLM_MODEL: "warn-once-test-live",
      LLM_BASE_URL: "https://api.openai.com/v1",
    };
    expect(readLlmConfig(env).ok).toBe(true);
    expect(readLlmConfig(env).ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("secret-key-do-not-log");
  });
});
