import { describe, expect, it } from "vitest";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import { geminiLiveClientAdapter } from "@/lib/transcripts/adapters/gemini-live-client";
import {
  MAX_ENTRY_CHARS,
  MAX_TOTAL_CHARS,
  MAX_TRANSCRIPT_ENTRIES,
  fitToLimits,
} from "@/lib/transcripts/limits";
import type { TranscriptAdapter } from "@/lib/transcripts/types";
import { validateTranscriptBody } from "@/lib/transcripts/validation";

const payload = (over: Record<string, unknown> = {}) => ({
  entries: [
    { speaker: "interviewer", text: "Tell me about indexes." },
    { speaker: "candidate", text: "They speed up reads.", interrupted: true },
  ],
  durationSeconds: 95,
  endedReason: "user_ended",
  ...over,
});

const body = (p: unknown = payload()) => ({ source: "client_gemini_live", payload: p });

describe("Gemini Live client adapter", () => {
  it("maps entries to canonical turns plus metadata", () => {
    const result = geminiLiveClientAdapter.parse(payload());
    expect(result).toEqual({
      ok: true,
      value: {
        transcript: [
          { role: "interviewer", text: "Tell me about indexes." },
          { role: "candidate", text: "They speed up reads." },
        ],
        metadata: {
          source: "client_gemini_live",
          durationSeconds: 95,
          endedReason: "user_ended",
        },
      },
    });
  });

  it("cleans text and drops entries that end up empty", () => {
    const result = geminiLiveClientAdapter.parse(
      payload({
        entries: [
          { speaker: "candidate", text: "  hi\u0000 \n there  " },
          { speaker: "interviewer", text: " \n\t " },
        ],
      }),
    );
    expect(result.ok && result.value.transcript).toEqual([
      { role: "candidate", text: "hi there" },
    ]);
  });

  it("accepts an empty entries list (session ended before anyone spoke)", () => {
    const result = geminiLiveClientAdapter.parse(payload({ entries: [] }));
    expect(result.ok && result.value.transcript).toEqual([]);
  });

  it.each([
    ["unknown payload key", payload({ userId: "x" })],
    ["unknown entry key", payload({ entries: [{ speaker: "candidate", text: "a", id: 1 }] })],
    ["bad speaker", payload({ entries: [{ speaker: "user", text: "a" }] })],
    ["non-string text", payload({ entries: [{ speaker: "candidate", text: 5 }] })],
    ["non-boolean interrupted", payload({ entries: [{ speaker: "candidate", text: "a", interrupted: "y" }] })],
    ["entries not an array", payload({ entries: "nope" })],
    ["negative duration", payload({ durationSeconds: -1 })],
    ["fractional duration", payload({ durationSeconds: 1.5 })],
    ["huge duration", payload({ durationSeconds: 99999 })],
    ["unknown reason", payload({ endedReason: "because" })],
    ["missing reason", payload({ endedReason: undefined })],
    ["array payload", []],
    ["null payload", null],
  ])("rejects %s", (_name, p) => {
    expect(geminiLiveClientAdapter.parse(p).ok).toBe(false);
  });
});

describe("validateTranscriptBody", () => {
  it("accepts a valid body", () => {
    const result = validateTranscriptBody(body(), defaultAdapters);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown top-level keys, including userId", () => {
    const result = validateTranscriptBody({ ...body(), userId: "x" }, defaultAdapters);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.errors.join(" ")).toContain('Unknown field "userId"');
  });

  it.each([null, [], "x", 5])("rejects a non-object body %j", (b) => {
    expect(validateTranscriptBody(b, defaultAdapters).ok).toBe(false);
  });

  it("rejects a missing, unknown or inherited source", () => {
    expect(validateTranscriptBody({ payload: payload() }, defaultAdapters).ok).toBe(false);
    expect(validateTranscriptBody({ source: "vapi", payload: payload() }, defaultAdapters).ok).toBe(false);
    expect(validateTranscriptBody({ source: "constructor", payload: payload() }, defaultAdapters).ok).toBe(false);
  });

  it("requires a payload", () => {
    expect(validateTranscriptBody({ source: "client_gemini_live" }, defaultAdapters).ok).toBe(false);
  });

  it("rejects more than the maximum number of entries", () => {
    const entries = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 1 }, () => ({
      speaker: "candidate",
      text: "a",
    }));
    const result = validateTranscriptBody(body(payload({ entries })), defaultAdapters);
    expect(!result.ok && result.errors.join(" ")).toContain("at most 200 entries");
  });

  it("accepts exactly the maximum number of entries", () => {
    const entries = Array.from({ length: MAX_TRANSCRIPT_ENTRIES }, () => ({
      speaker: "candidate",
      text: "a",
    }));
    expect(validateTranscriptBody(body(payload({ entries })), defaultAdapters).ok).toBe(true);
  });

  it("rejects an entry over the per-entry limit", () => {
    const entries = [{ speaker: "candidate", text: "x".repeat(MAX_ENTRY_CHARS + 1) }];
    const result = validateTranscriptBody(body(payload({ entries })), defaultAdapters);
    expect(!result.ok && result.errors.join(" ")).toContain("transcript[0].text");
  });

  it("rejects a transcript over the total character limit", () => {
    const per = MAX_ENTRY_CHARS;
    const count = Math.ceil((MAX_TOTAL_CHARS + 1) / per);
    const entries = Array.from({ length: count }, () => ({
      speaker: "candidate",
      text: "x".repeat(per),
    }));
    const result = validateTranscriptBody(body(payload({ entries })), defaultAdapters);
    expect(!result.ok && result.errors.join(" ")).toContain("characters in total");
  });

  it("applies the same limits to any registered adapter", () => {
    const fake: TranscriptAdapter = {
      source: "client_gemini_live",
      parse: () => ({
        ok: true,
        value: {
          transcript: Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 1 }, () => ({
            role: "candidate" as const,
            text: "a",
          })),
          metadata: { source: "client_gemini_live", durationSeconds: 1, endedReason: "error" },
        },
      }),
    };
    expect(validateTranscriptBody(body({}), { client_gemini_live: fake }).ok).toBe(false);
  });
});

describe("fitToLimits (client side)", () => {
  it("leaves a transcript within limits untouched", () => {
    const entries = [{ text: "a" }, { text: "b" }];
    expect(fitToLimits(entries)).toEqual(entries);
  });

  it("cuts long entries and drops the oldest entries over the total", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: i,
      text: "x".repeat(MAX_ENTRY_CHARS + 500),
    }));
    const fitted = fitToLimits(entries);
    expect(fitted.every((e) => e.text.length === MAX_ENTRY_CHARS)).toBe(true);
    expect(fitted.reduce((n, e) => n + e.text.length, 0)).toBeLessThanOrEqual(MAX_TOTAL_CHARS);
    expect(fitted.at(-1)!.id).toBe(4);
  });

  it("keeps only the newest entries when there are too many", () => {
    const entries = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 10 }, (_, i) => ({
      id: i,
      text: "a",
    }));
    const fitted = fitToLimits(entries);
    expect(fitted).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    expect(fitted[0].id).toBe(10);
  });
});
