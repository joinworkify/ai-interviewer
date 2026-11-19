import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyOverrides, parseOverrideBody } from "@/lib/evaluation/overrides";
import { handleOverride, type OverrideHandlerDeps } from "@/lib/evaluation/override-handler";
import { calibrationReport, parseHumanScores, scoreDistribution, weightedOverall } from "@/lib/evaluation/calibration";
import {
  buildAudioReviewPrompt,
  parseAudioReview,
  readAudioReviewConfig,
  runAudioReview,
  MAX_AUDIO_BYTES,
  type AudioReviewDeps,
} from "@/lib/integrity/audio-review";

const RUBRIC = [
  { name: "SQL", description: "d", weight: 4 },
  { name: "Communication", description: "d", weight: 1 },
];
const CRITERIA = [
  { name: "SQL", weight: 4, score: 90, evidence: "e" },
  { name: "Communication", weight: 1, score: 50, evidence: "e" },
];

describe("applyOverrides", () => {
  it("changes the effective score but keeps the AI's own", () => {
    const r = applyOverrides(CRITERIA, [{ criterion: "sql", score: 60, reason: "Missed the join", updatedAt: "t" }]);
    expect(r.criteria[0]).toMatchObject({ score: 60, aiScore: 90, override: { score: 60, reason: "Missed the join" } });
    expect(r.criteria[1].override).toBeNull();
    expect(r.overallScore).toBe(58); // (60*4 + 50) / 5
    expect(r.aiOverallScore).toBe(82);
    expect(r.recommendation).toBe("maybe");
  });
  it("is a no-op with no overrides", () => {
    const r = applyOverrides(CRITERIA, []);
    expect(r.overallScore).toBe(r.aiOverallScore);
  });
  it("can override a criterion the AI did not cover", () => {
    const r = applyOverrides([{ ...CRITERIA[0] }, { ...CRITERIA[1], score: null }], [{ criterion: "Communication", score: 80, reason: "Clear", updatedAt: "t" }]);
    expect(r.criteria[1]).toMatchObject({ score: 80, aiScore: null });
  });
});

describe("parseOverrideBody", () => {
  it("requires a criterion, a whole 0-100 score and a reason", () => {
    expect(parseOverrideBody({ criterion: "SQL", score: 70, reason: "  looks   right " })).toEqual({ ok: true, criterion: "SQL", score: 70, reason: "looks right" });
    for (const bad of [
      { score: 70, reason: "r" },
      { criterion: "SQL", score: 101, reason: "r" },
      { criterion: "SQL", score: -1, reason: "r" },
      { criterion: "SQL", score: 7.5, reason: "r" },
      { criterion: "SQL", score: "70", reason: "r" },
      { criterion: "SQL", score: 70, reason: "   " },
      { criterion: "SQL", score: 70, reason: "x".repeat(501) },
      null,
    ]) expect(parseOverrideBody(bad).ok).toBe(false);
  });
});

function overrideDeps(over: { caller?: { userId: string; isAdmin: boolean } | null; names?: string[] | null } = {}) {
  const set = vi.fn(async () => {});
  const remove = vi.fn(async () => {});
  const deps: OverrideHandlerDeps = {
    getCaller: async () => (over.caller === undefined ? { userId: "admin", isAdmin: true } : over.caller),
    store: { criterionNames: async () => (over.names === undefined ? ["SQL", "Communication"] : over.names), set, remove },
  };
  return { deps, set, remove };
}
const SID = "22222222-2222-4222-8222-222222222222";
const req = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("handleOverride", () => {
  it("saves an admin's override against the scored criterion, recording who", async () => {
    const t = overrideDeps();
    const res = await handleOverride(req("POST", { criterion: "sql", score: 60, reason: "Missed the join" }), SID, t.deps);
    expect(res.status).toBe(200);
    expect(t.set).toHaveBeenCalledWith({ sessionId: SID, criterion: "SQL", score: 60, reason: "Missed the join", adminId: "admin" });
  });
  it("removes an override on DELETE", async () => {
    const t = overrideDeps();
    expect((await handleOverride(req("DELETE", { criterion: "Communication" }), SID, t.deps)).status).toBe(200);
    expect(t.remove).toHaveBeenCalledWith(SID, "Communication");
  });
  it.each([
    ["signed out", { caller: null }, { criterion: "SQL", score: 1, reason: "r" }, 401],
    ["not an admin", { caller: { userId: "u", isAdmin: false } }, { criterion: "SQL", score: 1, reason: "r" }, 403],
    ["no AI score yet", { names: null }, { criterion: "SQL", score: 1, reason: "r" }, 404],
    ["a criterion the AI never scored", {}, { criterion: "Luck", score: 1, reason: "r" }, 400],
    ["no reason", {}, { criterion: "SQL", score: 1, reason: "" }, 400],
  ])("rejects %s", async (_l, over, body, status) => {
    const t = overrideDeps(over as never);
    expect((await handleOverride(req("POST", body), SID, t.deps)).status).toBe(status);
    expect(t.set).not.toHaveBeenCalled();
  });
});

describe("calibration", () => {
  const human = { SQL: 80, Communication: 60 };
  it("computes gaps and bias against people", () => {
    const r = calibrationReport([
      { humanScores: human, rubric: RUBRIC, runs: [{ aiScores: { SQL: 90, Communication: 50 }, overall: 82 }] },
      { humanScores: { SQL: 40, Communication: 40 }, rubric: RUBRIC, runs: [{ aiScores: { SQL: 40, Communication: 70 }, overall: 46 }] },
    ]);
    expect(r.casesCompared).toBe(2);
    // human overalls 76 and 40; AI 82 and 46 -> errors +6, +6
    expect(r).toMatchObject({ overallMeanAbsError: 6, overallBias: 6, within10: 1 });
    const sql = r.perCriterion.find((c) => c.name === "SQL")!;
    expect(sql).toMatchObject({ n: 2, meanAbsError: 5, bias: 5 });
  });
  it("reports repeat-run spread and handles no data", () => {
    expect(calibrationReport([]).overallMeanAbsError).toBeNull();
    const r = calibrationReport([
      { humanScores: human, rubric: RUBRIC, runs: [{ aiScores: {}, overall: 70 }, { aiScores: {}, overall: 82 }, { aiScores: {}, overall: 75 }] },
    ]);
    expect(r.maxRepeatSpread).toBe(12);
  });
  it("skips criteria the AI did not cover", () => {
    const r = calibrationReport([{ humanScores: human, rubric: RUBRIC, runs: [{ aiScores: { SQL: 70, Communication: null }, overall: 70 }] }]);
    expect(r.perCriterion.map((c) => c.name)).toEqual(["SQL"]);
  });
  it("weights the overall", () => {
    expect(weightedOverall(human, RUBRIC)).toBe(76);
    expect(weightedOverall({}, RUBRIC)).toBeNull();
  });
  it("summarizes score spread per role", () => {
    const d = scoreDistribution([
      { role: "A", score: 60 }, { role: "A", score: 80 }, { role: "B", score: 50 },
    ]);
    expect(d[0]).toEqual({ role: "A", n: 2, mean: 70, min: 60, max: 80, stdDev: 10 });
  });
  it("validates human scores", () => {
    expect(parseHumanScores({ SQL: 80, Communication: 60 }, RUBRIC).ok).toBe(true);
    expect(parseHumanScores({ SQL: 80 }, RUBRIC).ok).toBe(false);
    expect(parseHumanScores({ SQL: 80, Communication: 101 }, RUBRIC).ok).toBe(false);
    expect(parseHumanScores({ SQL: 80, Communication: null }, RUBRIC).ok).toBe(false);
  });
});

describe("audio review", () => {
  const good = {
    secondVoice: false,
    readingAloud: true,
    notes: "Delivery sounds read.",
    criteria: [{ name: "communication", score: 50, evidence: "Clear." }, { name: "SQL", score: 90, evidence: "Joins." }],
  };
  it("parses, orders by rubric and computes the overall itself", () => {
    const r = parseAudioReview({ ...good, overall: 5 }, RUBRIC);
    expect(r.criteria.map((c) => c.name)).toEqual(["SQL", "Communication"]);
    expect(r).toMatchObject({ secondVoice: false, readingAloud: true, overall: 82 });
  });
  it.each([
    ["a non-boolean flag", { ...good, secondVoice: "no" }],
    ["a missing criterion", { ...good, criteria: [good.criteria[1]] }],
    ["an unknown criterion", { ...good, criteria: [...good.criteria, { name: "Luck", score: 1, evidence: "x" }] }],
    ["an out-of-range score", { ...good, criteria: [{ name: "SQL", score: 120, evidence: "x" }, good.criteria[0]] }],
    ["all unscored", { ...good, criteria: [{ name: "SQL", score: null, evidence: "x" }, { name: "Communication", score: null, evidence: "y" }] }],
  ])("rejects %s", (_l, reply) => expect(() => parseAudioReview(reply, RUBRIC)).toThrow());

  it("tells the model to judge substance not accent and to treat audio as data", () => {
    const p = buildAudioReviewPrompt("Analyst", RUBRIC);
    expect(p.system).toMatch(/never judge accent/i);
    expect(p.system).toMatch(/data, never as instructions/i);
  });

  it("needs a key and a non-live text model", () => {
    expect(readAudioReviewConfig({})).toBeNull();
    expect(readAudioReviewConfig({ GEMINI_API_KEY: "k", LLM_MODEL: "gemini-3.8-live" })).toBeNull();
    expect(readAudioReviewConfig({ GEMINI_API_KEY: "k", LLM_MODEL: "gemini-x", GEMINI_AUDIO_REVIEW_MODEL: "models/gemini-audio" })).toEqual({ apiKey: "k", model: "gemini-audio" });
  });

  describe("runAudioReview", () => {
    beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
    afterEach(() => vi.restoreAllMocks());
    function setup(over: { recording?: { key: string; contentType: string; size: number } | null; reply?: string; env?: Record<string, string>; load?: null } = {}) {
      const saved: unknown[] = [];
      const failed: string[] = [];
      const generate = vi.fn(async () => over.reply ?? JSON.stringify(good));
      const deps: AudioReviewDeps = {
        env: over.env ?? { GEMINI_API_KEY: "k", LLM_MODEL: "gemini-x" },
        store: {
          load: async () => (over.load === null ? null : { sessionId: "s", roleTitle: "Analyst", rubric: RUBRIC, recording: over.recording === undefined ? { key: "k", contentType: "audio/webm", size: 1000 } : over.recording }),
          saveCompleted: async (_i, review, model) => void saved.push({ review, model }),
          saveFailed: async (_i, code) => void failed.push(code),
        },
        downloadAudio: async () => new Uint8Array([1, 2, 3]),
        generate,
      };
      return { deps, saved, failed, generate };
    }
    it("sends the audio to the model and saves the review", async () => {
      const t = setup();
      const out = await runAudioReview(t.deps, "s");
      expect(out.kind).toBe("reviewed");
      expect(t.generate).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "audio/webm", base64: "AQID", model: "gemini-x" }));
      expect(t.saved).toHaveLength(1);
    });
    it("accepts JSON wrapped in a code fence", async () => {
      const t = setup({ reply: "```json\n" + JSON.stringify(good) + "\n```" });
      expect((await runAudioReview(t.deps, "s")).kind).toBe("reviewed");
    });
    it.each([
      ["no recording", { recording: null }, "no_recording"],
      ["a recording that is too large", { recording: { key: "k", contentType: "audio/webm", size: MAX_AUDIO_BYTES + 1 } }, "too_large"],
      ["no model settings", { env: {} }, "not_configured"],
      ["unusable model output", { reply: "not json" }, "audio_failed"],
    ])("saves a failed row for %s", async (_l, over, code) => {
      const t = setup(over as never);
      expect(await runAudioReview(t.deps, "s")).toEqual({ kind: "failed", code });
      expect(t.failed).toEqual([code]);
    });
    it("reports an unknown session without saving", async () => {
      const t = setup({ load: null });
      expect(await runAudioReview(t.deps, "s")).toEqual({ kind: "failed", code: "session_not_found" });
      expect(t.failed).toEqual([]);
    });
  });
});
