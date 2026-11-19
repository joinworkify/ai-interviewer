import { describe, expect, it } from "vitest";
import { initialTranscript, reduceTranscript } from "@/lib/gemini-live/transcript";

describe("candidate captions from the browser recognizer", () => {
  it("shows the phrase as it grows, then finalizes it", () => {
    let s = initialTranscript();
    s = reduceTranscript(s, { type: "captions", text: "I used", final: false });
    s = reduceTranscript(s, { type: "captions", text: "I used AI to write the code", final: false });
    expect(s.entries).toEqual([
      { id: 1, speaker: "candidate", text: "I used AI to write the code", final: false },
    ]);
    s = reduceTranscript(s, { type: "captions", text: "I used AI to write the code.", final: true });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ text: "I used AI to write the code.", final: true });
    expect(s.openCandidate).toBeNull();
  });

  it("starts a new entry for the next phrase", () => {
    let s = initialTranscript();
    s = reduceTranscript(s, { type: "captions", text: "First answer.", final: true });
    s = reduceTranscript(s, { type: "captions", text: "Second", final: false });
    expect(s.entries.map((e) => e.text)).toEqual(["First answer.", "Second"]);
    expect(s.entries[1].final).toBe(false);
  });

  it("ignores empty captions", () => {
    const s = reduceTranscript(initialTranscript(), { type: "captions", text: "  ", final: false });
    expect(s.entries).toEqual([]);
  });
});
