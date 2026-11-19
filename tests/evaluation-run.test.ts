import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UsageStore } from "@/lib/ai/usage";
import { runRubricEvaluation, type EvaluationInput, type EvaluationStore } from "@/lib/evaluation/run";

const SID = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-2222-4333-8444-555555555555";
const ENV = {
  LLM_API_KEY: "test-key",
  LLM_MODEL: "gemini-test",
  LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
};
const RUBRIC = [
  { name: "SQL", description: "Writes correct queries.", weight: 4 },
  { name: "Communication", description: "Explains clearly.", weight: 1 },
];
const LONG_ANSWER = "I would join the orders table to the customers table on the customer id and then group by region ".repeat(2);
const INPUT: EvaluationInput = {
  sessionId: SID,
  userId: USER,
  roleTitle: "Data Analyst",
  rubric: RUBRIC,
  transcript: [
    { role: "interviewer", text: "How would you total sales by region?" },
    { role: "candidate", text: LONG_ANSWER },
  ],
};
const GOOD = {
  criteria: [
    { name: "SQL", score: 90, evidence: "Joined and grouped correctly." },
    { name: "Communication", score: 50, evidence: "Clear but brief." },
  ],
  summary: "Strong SQL.",
  strengths: ["Joins"],
  concerns: [],
};

function reply(content: unknown) {
  return new Response(
    JSON.stringify({
      model: "served-model",
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
    { status: 200 },
  );
}

function setup(over: { input?: EvaluationInput | null; completed?: boolean; used?: number; env?: Record<string, string> } = {}) {
  const saved: unknown[] = [];
  const failed: string[] = [];
  const store: EvaluationStore = {
    load: async () => (over.input === undefined ? INPUT : over.input),
    hasCompleted: async () => over.completed ?? false,
    saveCompleted: async (_id, evaluation, model) => void saved.push({ evaluation, model }),
    saveFailed: async (_id, code) => void failed.push(code),
  };
  const record = vi.fn(async () => {});
  const usage: UsageStore = { countSince: async () => over.used ?? 0, record };
  const fetchMock = vi.fn<(url: unknown, init?: RequestInit) => Promise<Response>>(async () => reply(GOOD));
  const deps = { env: over.env ?? ENV, store, usage, fetch: fetchMock as unknown as typeof fetch };
  return { deps, saved, failed, record, fetchMock };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("runRubricEvaluation", () => {
  it("scores against the role's rubric, saves it and records usage", async () => {
    const t = setup();
    const out = await runRubricEvaluation(t.deps, SID);
    expect(out.kind).toBe("evaluated");
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0]).toMatchObject({ model: "served-model", evaluation: { overallScore: 82, recommendation: "strong_yes" } });
    expect(t.record).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, feature: "rubric-evaluation" }));
    expect(t.failed).toEqual([]);
  });

  it("falls back to the default rubric when the role has none", async () => {
    const t = setup({ input: { ...INPUT, rubric: [] } });
    t.fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const user = JSON.parse(body.messages[1].content);
      return reply({
        criteria: user.rubric.map((c: { name: string }) => ({ name: c.name, score: 70, evidence: "ok" })),
        summary: "Fine.",
        strengths: [],
        concerns: [],
      });
    });
    const out = await runRubricEvaluation(t.deps, SID);
    expect(out.kind).toBe("evaluated");
    expect(out.kind === "evaluated" && out.evaluation.criteria.length).toBeGreaterThanOrEqual(4);
  });

  it("does not re-score a completed evaluation unless forced", async () => {
    const t = setup({ completed: true });
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "skipped", reason: "already_evaluated" });
    expect(t.fetchMock).not.toHaveBeenCalled();
    const forced = await runRubricEvaluation(t.deps, SID, { force: true });
    expect(forced.kind).toBe("evaluated");
  });

  it("reports an unknown session without saving anything", async () => {
    const t = setup({ input: null });
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "failed", code: "session_not_found" });
    expect(t.failed).toEqual([]);
  });

  it.each([
    ["no transcript", { ...INPUT, transcript: null }, "no_transcript"],
    ["an unreadable transcript", { ...INPUT, transcript: 42 }, "no_transcript"],
    ["a candidate who said almost nothing", { ...INPUT, transcript: [{ role: "candidate", text: "yes" }] }, "too_short"],
  ])("saves a failed row for %s, without calling the model", async (_label, input, code) => {
    const t = setup({ input: input as EvaluationInput });
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "failed", code });
    expect(t.failed).toEqual([code]);
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("saves a failed row when the model is not configured", async () => {
    const t = setup({ env: {} });
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "failed", code: "llm_not_configured" });
    expect(t.failed).toEqual(["llm_not_configured"]);
  });

  it("stops at the daily limit, except when an admin forces a re-score", async () => {
    const t = setup({ used: 9999 });
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "failed", code: "quota" });
    expect((await runRubricEvaluation(t.deps, SID, { force: true })).kind).toBe("evaluated");
  });

  it("saves llm_failed (and still records spend) when the model output is unusable", async () => {
    const t = setup();
    t.fetchMock.mockImplementation(async () => reply({ criteria: [], summary: "x" }));
    expect(await runRubricEvaluation(t.deps, SID)).toEqual({ kind: "failed", code: "llm_failed" });
    expect(t.failed).toEqual(["llm_failed"]);
    expect(t.saved).toEqual([]);
    expect(t.record).toHaveBeenCalled();
  });
});
