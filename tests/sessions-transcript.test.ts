import { describe, expect, it } from "vitest";
import {
  MAX_TRANSCRIPT_CHARS,
  normalizeTranscript,
} from "@/lib/sessions/transcript";

describe("normalizeTranscript", () => {
  it("reads Vapi-style message arrays and drops system/tool turns", () => {
    const r = normalizeTranscript([
      { role: "system", message: "You are an interviewer" },
      { role: "bot", message: "Tell me about React." },
      { role: "user", message: "I  have\n used it for 3 years." },
      { role: "tool", content: "ignored" },
      { role: "assistant", content: "Great." },
    ]);
    expect(r).toEqual({
      ok: true,
      turns: [
        { role: "interviewer", text: "Tell me about React." },
        { role: "candidate", text: "I have used it for 3 years." },
        { role: "interviewer", text: "Great." },
      ],
    });
  });

  it("reads { messages: [...] }", () => {
    const r = normalizeTranscript({
      messages: [{ role: "user", message: "Hello" }],
    });
    expect(r).toEqual({ ok: true, turns: [{ role: "candidate", text: "Hello" }] });
  });

  it("reads a role-prefixed string and joins continuation lines", () => {
    const r = normalizeTranscript("AI: Why this role?\nUser: Because I like\nbuilding things.\nAI: Thanks");
    expect(r).toEqual({
      ok: true,
      turns: [
        { role: "interviewer", text: "Why this role?" },
        { role: "candidate", text: "Because I like building things." },
        { role: "interviewer", text: "Thanks" },
      ],
    });
  });

  it("keeps an unlabeled string as one unknown turn", () => {
    expect(normalizeTranscript("just some words")).toEqual({
      ok: true,
      turns: [{ role: "unknown", text: "just some words" }],
    });
  });

  it("strips control characters", () => {
    const r = normalizeTranscript([{ role: "user", message: "a\u0000b\u0007c" }]);
    expect(r).toEqual({ ok: true, turns: [{ role: "candidate", text: "a b c" }] });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["number", 5],
    ["empty array", []],
    ["empty string", "   "],
    ["object without messages", { foo: 1 }],
    ["only interviewer turns", [{ role: "assistant", message: "Hello?" }]],
    ["only blank candidate turns", [{ role: "user", message: "  " }]],
  ])("is empty for %s", (_n, value) => {
    expect(normalizeTranscript(value)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects transcripts over the size cap", () => {
    const r = normalizeTranscript([
      { role: "user", message: "x".repeat(MAX_TRANSCRIPT_CHARS + 1) },
    ]);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("accepts a transcript exactly at the cap", () => {
    const r = normalizeTranscript([
      { role: "user", message: "x".repeat(MAX_TRANSCRIPT_CHARS) },
    ]);
    expect(r.ok).toBe(true);
  });
});
