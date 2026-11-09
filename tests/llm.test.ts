import { describe, expect, it, vi } from "vitest";
import {
  generateQuestions,
  LlmError,
  parseQuestions,
  readLlmConfig,
  type LlmConfig,
} from "@/lib/interviews/llm";
import type { GenerateInterviewInput } from "@/lib/interviews/validation";

const input: GenerateInterviewInput = {
  role: "Backend Engineer",
  level: "Mid",
  type: "mixed",
  techstack: ["Go"],
  amount: 2,
};
const config: LlmConfig = {
  apiKey: "k",
  model: "m",
  baseUrl: "https://llm.example.test/v1",
  timeoutMs: 1000,
};

function chat(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("readLlmConfig", () => {
  it("reports missing credentials and model", () => {
    expect(readLlmConfig({})).toEqual({
      ok: false,
      missing: ["LLM_API_KEY", "LLM_MODEL"],
      invalid: [],
    });
  });

  it("rejects non-https base URLs and bad timeouts", () => {
    const r = readLlmConfig({
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
      LLM_BASE_URL: "http://evil.test",
      LLM_TIMEOUT_MS: "5",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.invalid).toHaveLength(2);
  });

  it("defaults base URL and strips trailing slash", () => {
    expect(readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m" })).toMatchObject({
      ok: true,
      config: { baseUrl: "https://api.openai.com/v1" },
    });
    expect(
      readLlmConfig({ LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "https://x.test/v1/" }),
    ).toMatchObject({ ok: true, config: { baseUrl: "https://x.test/v1" } });
  });
});

describe("parseQuestions", () => {
  it("parses object, bare array, and fenced output", () => {
    expect(parseQuestions('{"questions":["A?","B?"]}', 2)).toEqual(["A?", "B?"]);
    expect(parseQuestions('["A?","B?","C?"]', 2)).toEqual(["A?", "B?"]);
    expect(parseQuestions('```json\n{"questions":["**A?**","B?"]}\n```', 2)).toEqual([
      "A?",
      "B?",
    ]);
  });

  it.each([
    ["empty", ""],
    ["non-string", 42],
    ["not json", "Here are your questions: 1. A?"],
    ["no questions key", '{"items":["A?"]}'],
    ["non-string item", '{"questions":["A?", 2]}'],
    ["too few", '{"questions":["A?"]}'],
  ])("throws bad_output for %s", (_n, content) => {
    try {
      parseQuestions(content, 2);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).kind).toBe("bad_output");
    }
  });
});

describe("generateQuestions", () => {
  it("calls the chat completions endpoint with bearer auth", async () => {
    const fetchMock = vi.fn(async () => chat('{"questions":["A?","B?"]}'));
    const result = await generateQuestions(input, config, fetchMock as typeof fetch);
    expect(result).toEqual(["A?", "B?"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("m");
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "upstream"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("nope", { status }));
    await expect(
      generateQuestions(input, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ kind, upstreamStatus: status });
    spy.mockRestore();
  });

  it("maps timeouts and network failures", async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      generateQuestions(input, config, timeout as typeof fetch),
    ).rejects.toMatchObject({ kind: "timeout" });

    const network = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      generateQuestions(input, config, network as typeof fetch),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects a 2xx response without usable content", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      generateQuestions(input, config, fetchMock as typeof fetch),
    ).rejects.toMatchObject({ kind: "bad_output" });
  });
});
