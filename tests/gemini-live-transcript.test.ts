import { describe, expect, it } from "vitest";
import {
  initialTranscript,
  reduceTranscript,
  type TranscriptEvent,
  type TranscriptState,
} from "@/lib/gemini-live/transcript";

function run(events: TranscriptEvent[], start = initialTranscript()) {
  return events.reduce<TranscriptState>(reduceTranscript, start);
}

function view(state: TranscriptState) {
  return state.entries.map((e) => ({
    speaker: e.speaker,
    text: e.text,
    final: e.final,
    ...(e.interrupted ? { interrupted: true } : {}),
  }));
}

describe("reduceTranscript", () => {
  it("accumulates incremental chunks into one partial entry per speaker", () => {
    const s = run([
      { type: "output", text: "Hello, " },
      { type: "output", text: "welcome to" },
      { type: "output", text: " the interview." },
    ]);
    expect(view(s)).toEqual([
      { speaker: "interviewer", text: "Hello, welcome to the interview.", final: false },
    ]);
  });

  it("finalizes on turnComplete and starts a new entry for the next turn", () => {
    const s = run([
      { type: "output", text: "First question?" },
      { type: "turnComplete" },
      { type: "input", text: "My answer" },
      { type: "output", text: "Thanks." },
      { type: "turnComplete" },
    ]);
    expect(view(s)).toEqual([
      { speaker: "interviewer", text: "First question?", final: true },
      { speaker: "candidate", text: "My answer", final: true },
      { speaker: "interviewer", text: "Thanks.", final: true },
    ]);
  });

  it("appends late candidate chunks to the candidate entry above the reply", () => {
    const s = run([
      { type: "input", text: "I used" },
      { type: "output", text: "Great," },
      { type: "input", text: " React hooks." },
      { type: "output", text: " next question." },
      { type: "turnComplete" },
    ]);
    expect(view(s)).toEqual([
      { speaker: "candidate", text: "I used React hooks.", final: true },
      { speaker: "interviewer", text: "Great, next question.", final: true },
    ]);
  });

  it("marks the interrupted reply and starts a fresh candidate entry after it", () => {
    const s = run([
      { type: "input", text: "Answer one." },
      { type: "output", text: "So tell me about" },
      { type: "interrupted" },
      { type: "input", text: "Sorry, one more thing" },
    ]);
    expect(view(s)).toEqual([
      { speaker: "candidate", text: "Answer one.", final: true },
      {
        speaker: "interviewer",
        text: "So tell me about",
        final: true,
        interrupted: true,
      },
      { speaker: "candidate", text: "Sorry, one more thing", final: false },
    ]);
  });

  it("keeps barge-in speech that was transcribed before the interrupted signal", () => {
    const s = run([
      { type: "output", text: "Can you explain" },
      { type: "input", text: "Wait," },
      { type: "interrupted" },
      { type: "input", text: " can you repeat?" },
    ]);
    expect(view(s)).toEqual([
      {
        speaker: "interviewer",
        text: "Can you explain",
        final: true,
        interrupted: true,
      },
      { speaker: "candidate", text: "Wait, can you repeat?", final: false },
    ]);
  });

  it("honours the finished flag and normalizes whitespace on finalize", () => {
    const s = run([
      { type: "input", text: "  hello   there ", finished: true },
      { type: "input", text: "new utterance" },
    ]);
    expect(view(s)).toEqual([
      { speaker: "candidate", text: "hello there", final: true },
      { speaker: "candidate", text: "new utterance", final: false },
    ]);
  });

  it("drops entries that are empty after finalize and ignores empty chunks", () => {
    const s = run([
      { type: "output", text: "" },
      { type: "output", text: "   " },
      { type: "turnComplete" },
    ]);
    expect(s.entries).toEqual([]);
  });

  it("finalizeAll closes every open entry", () => {
    const s = run([
      { type: "input", text: "partial" },
      { type: "output", text: "also partial" },
      { type: "finalizeAll" },
    ]);
    expect(s.entries.every((e) => e.final)).toBe(true);
    expect(s.openCandidate).toBeNull();
    expect(s.openInterviewer).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const a = run([{ type: "output", text: "Hi" }]);
    const snapshot = JSON.stringify(a);
    reduceTranscript(a, { type: "output", text: " there" });
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it("assigns stable unique ids", () => {
    const s = run([
      { type: "output", text: "Q1" },
      { type: "turnComplete" },
      { type: "input", text: "A1" },
      { type: "input", text: " more" },
    ]);
    expect(new Set(s.entries.map((e) => e.id)).size).toBe(2);
  });
});
