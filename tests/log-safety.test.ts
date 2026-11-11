import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LlmError } from "@/lib/ai/client";
import type { UsageStore } from "@/lib/ai/usage";
import { describeError } from "@/lib/log/safe-error";
import { handleSubmitFeedback, type SessionHandlerDeps } from "@/lib/sessions/handlers";
import {
  createSupabaseSessionStore,
  type FeedbackRecord,
  type NewFeedback,
  type SessionRecord,
  type SessionStore,
} from "@/lib/sessions/store";

import { fakeClient } from "./helpers/fake-supabase";

/**
 * Nothing that touched user content may reach the logs. CANARY stands for
 * transcript text, a token or a key; every console method is captured and the
 * test fails if it shows up anywhere.
 */

const CANARY = "TRANSCRIPT-CANARY-9f3a sk-live-CANARY-KEY";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IV = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const env = { LLM_API_KEY: "key", LLM_MODEL: "model", LLM_BASE_URL: "https://llm.example/v1" };

let logged: string[];

function capture() {
  logged = [];
  for (const method of ["log", "info", "debug", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(
        args
          .map((a) => {
            try {
              return typeof a === "string" ? a : JSON.stringify(a, Object.getOwnPropertyNames(Object(a)));
            } catch {
              return String(a);
            }
          })
          .join(" "),
      );
    });
  }
}

beforeEach(capture);
afterEach(() => vi.restoreAllMocks());

function expectNoCanary() {
  const all = logged.join("\n");
  expect(all).not.toContain("CANARY");
  expect(all).not.toContain("sk-live");
}

describe("describeError", () => {
  it("prints the class name only, never the message", () => {
    expect(describeError(new Error(CANARY))).toBe("Error");
    expect(describeError(new TypeError(CANARY))).toBe("TypeError");
  });

  it("adds a short kind or code slug when there is one", () => {
    expect(describeError(new LlmError("upstream", CANARY))).toBe("LlmError(upstream)");
    expect(describeError(Object.assign(new Error(CANARY), { code: "23505" }))).toBe("Error(23505)");
  });

  it("drops kind and code values that are not short slugs", () => {
    expect(describeError(Object.assign(new Error("x"), { code: CANARY }))).toBe("Error");
    expect(describeError({ name: CANARY, kind: "a b" })).toBe("Error");
  });

  it("handles non-objects", () => {
    expect(describeError(CANARY)).toBe("string");
    expect(describeError(null)).toBe("object");
    expect(describeError(undefined)).toBe("undefined");
  });
});

describe("handleSubmitFeedback logs no content", () => {
  class Store implements SessionStore {
    failComplete = false;
    async getInterview() {
      return { id: IV, questions: ["Q0?"] };
    }
    async createSession(): Promise<SessionRecord> {
      throw new Error("unused");
    }
    async getSession(): Promise<SessionRecord> {
      return {
        id: SID,
        interview_id: IV,
        user_id: ME,
        status: "in_progress",
        started_at: "2026-11-12T00:00:00Z",
        ended_at: null,
        transcript: [
          { role: "assistant", message: "Question?" },
          { role: "user", message: CANARY },
        ],
      };
    }
    async getFeedback() {
      return null;
    }
    async insertFeedback(row: NewFeedback): Promise<FeedbackRecord> {
      return { ...row, id: "f", created_at: "2026-11-12T00:00:00Z" };
    }
    async completeSession() {
      if (this.failComplete) throw new Error(`db said: ${CANARY}`);
    }
  }

  class Usage implements UsageStore {
    failCount = false;
    failRecord = false;
    async countSince() {
      if (this.failCount) throw new Error(`count failed ${CANARY}`);
      return 0;
    }
    async record() {
      if (this.failRecord) throw new Error(`record failed ${CANARY}`);
    }
  }

  const goodReply = () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                perAnswer: [{ questionIndex: 0, answerSummary: "s", score: 50, feedback: "f" }],
                strengths: ["a"],
                areasForImprovement: ["b"],
                finalAssessment: "ok",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 },
    );

  function run(over: Partial<SessionHandlerDeps>, store = new Store(), usage = new Usage()) {
    return handleSubmitFeedback(
      new Request("http://localhost/api/x", { method: "POST" }),
      SID,
      {
        env,
        getUserId: async () => ME,
        store,
        usage,
        now: () => 0,
        sleep: async () => {},
        fetch: (async () => goodReply()) as typeof fetch,
        ...over,
      },
    );
  }

  it("provider error whose body echoes the transcript and key", async () => {
    const echo = (async () =>
      new Response(JSON.stringify({ error: { message: `bad prompt: ${CANARY}` } }), { status: 500 })) as typeof fetch;
    const res = await run({ fetch: echo });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(logged.length).toBeGreaterThan(0); // it still logs the status
    expectNoCanary();
    expect(JSON.stringify(await res.json())).not.toContain("CANARY");
  });

  it("an unexpected error thrown out of the model call", async () => {
    const boom = (async () => {
      throw Object.assign(new Error(`fetch failed ${CANARY}`), { cause: new Error(CANARY) });
    }) as typeof fetch;
    await run({ fetch: boom });
    expectNoCanary();
  });

  it("quota lookup, session close and usage recording failures", async () => {
    const usage = new Usage();
    usage.failCount = true;
    await run({}, new Store(), usage);

    const usage2 = new Usage();
    usage2.failRecord = true;
    const store2 = new Store();
    store2.failComplete = true;
    const res = await run({}, store2, usage2);
    expect(res.status).toBe(201);
    expect(logged.length).toBeGreaterThan(0);
    expectNoCanary();
  });
});

describe("session store logs no row content", () => {
  it("logs the operation and Postgres code, not the error message", async () => {
    const { client } = fakeClient(() => ({
      data: null,
      error: { message: `invalid input syntax for type json. Token "${CANARY}" is invalid.`, code: "22P02" },
    }));
    const store = createSupabaseSessionStore(client, async () => ME);
    await expect(store.getSession(SID)).rejects.toThrow("getSession failed");
    expect(logged.join("\n")).toContain("22P02");
    expectNoCanary();
  });
});
