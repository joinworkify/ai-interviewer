import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfig } from "@/lib/ai/client";
import { LlmError } from "@/lib/ai/client";
import { chatJson, extractJsonText, parseJsonContent } from "@/lib/ai/json";

const config: LlmConfig = {
  apiKey: "k",
  model: "m",
  baseUrl: "https://llm.example/v1",
  timeoutMs: 5000,
};
const messages = [{ role: "user" as const, content: "go" }];

const reply = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200 },
  );

const needName = (v: unknown) => {
  const name = (v as { name?: unknown } | null)?.name;
  if (typeof name !== "string") throw new LlmError("bad_output", "no name");
  return name;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("extractJsonText / parseJsonContent", () => {
  it("unwraps one fenced block", () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(parseJsonContent('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it.each([undefined, null, 42, "", "   "])("rejects non-text %j", (c) => {
    expect(() => extractJsonText(c)).toThrowError(
      expect.objectContaining({ kind: "bad_output" }),
    );
  });

  it("rejects invalid JSON as bad_output", () => {
    expect(() => parseJsonContent("{nope")).toThrowError(
      expect.objectContaining({ kind: "bad_output" }),
    );
  });
});

describe("chatJson", () => {
  it("validates and returns the parsed value", async () => {
    const fetchMock = vi.fn(async () => reply('{"name":"Ada"}'));
    const res = await chatJson(config, messages, needName, {
      fetch: fetchMock as typeof fetch,
    });
    expect(res.data).toBe("Ada");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repairs once when the first output is unusable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply("not json"))
      .mockResolvedValueOnce(reply('{"name":"Ada"}'));
    const used: unknown[] = [];
    const res = await chatJson(config, messages, needName, {
      fetch: fetchMock as unknown as typeof fetch,
      onUsage: (u) => used.push(u),
    });
    expect(res.data).toBe("Ada");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both calls were billed, so both are reported.
    expect(used).toHaveLength(2);
  });

  it("throws bad_output after exhausting repairs, still reporting usage", async () => {
    const fetchMock = vi.fn(async () => reply('{"nope":true}'));
    const used: unknown[] = [];
    await expect(
      chatJson(config, messages, needName, {
        fetch: fetchMock as typeof fetch,
        repairAttempts: 2,
        onUsage: (u) => used.push(u),
      }),
    ).rejects.toMatchObject({ kind: "bad_output" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(used).toHaveLength(3);
  });

  it("does not repair transport failures", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(
      chatJson(config, messages, needName, { fetch: fetchMock as typeof fetch }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not swallow non-LlmError validator bugs", async () => {
    const fetchMock = vi.fn(async () => reply('{"name":"x"}'));
    await expect(
      chatJson(
        config,
        messages,
        () => {
          throw new TypeError("bug");
        },
        { fetch: fetchMock as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
