import { describe, expect, it } from "vitest";
import { normalizeTranscript } from "@/lib/sessions/transcript";

// Entries exactly as the Gemini Live controller keeps them
// (lib/gemini-live/transcript.ts TranscriptEntry).
const geminiEntries = [
  { id: 1, speaker: "interviewer", text: "Hello, tell me about indexes.", final: true },
  { id: 2, speaker: "candidate", text: " They speed up   reads. ", final: true },
  { id: 3, speaker: "interviewer", text: "And the cost?", final: true, interrupted: true },
  { id: 4, speaker: "candidate", text: "Slower writes.", final: false },
];

describe("normalizeTranscript with Gemini Live entries", () => {
  it("reads `speaker` and keeps the order", () => {
    const result = normalizeTranscript(geminiEntries);
    expect(result).toEqual({
      ok: true,
      turns: [
        { role: "interviewer", text: "Hello, tell me about indexes." },
        { role: "candidate", text: "They speed up reads." },
        { role: "interviewer", text: "And the cost?" },
        { role: "candidate", text: "Slower writes." },
      ],
    });
  });

  it("is empty when only the interviewer spoke", () => {
    expect(normalizeTranscript(geminiEntries.filter((e) => e.speaker === "interviewer"))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("reads the stored canonical shape and ignores `at`", () => {
    const stored = [
      { role: "interviewer", text: "Q?", at: "2026-11-11T10:00:00Z" },
      { role: "candidate", text: "A." },
    ];
    expect(normalizeTranscript(stored)).toEqual({
      ok: true,
      turns: [
        { role: "interviewer", text: "Q?" },
        { role: "candidate", text: "A." },
      ],
    });
  });

  it("prefers `role` when an entry has both", () => {
    const result = normalizeTranscript([
      { role: "candidate", speaker: "interviewer", text: "x" },
    ]);
    expect(result).toEqual({ ok: true, turns: [{ role: "candidate", text: "x" }] });
  });

  it("still reads Vapi messages", () => {
    const result = normalizeTranscript([
      { role: "assistant", message: "Hi" },
      { role: "user", message: "Hello" },
      { role: "system", message: "ignored" },
    ]);
    expect(result).toEqual({
      ok: true,
      turns: [
        { role: "interviewer", text: "Hi" },
        { role: "candidate", text: "Hello" },
      ],
    });
  });

  it("treats an unrecognized speaker as unknown rather than dropping the text", () => {
    const result = normalizeTranscript([{ speaker: "narrator", text: "words" }]);
    expect(result).toEqual({ ok: true, turns: [{ role: "unknown", text: "words" }] });
  });
});
