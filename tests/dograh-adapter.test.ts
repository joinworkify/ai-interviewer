import { describe, expect, it } from "vitest";

import {
  dograhWebhookAdapter,
  endedReasonFromDisposition,
  parseDograhTranscriptText,
} from "@/lib/transcripts/adapters/dograh-webhook";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import { validateTranscriptBody } from "@/lib/transcripts/validation";

import { TRANSCRIPT_TEXT } from "./helpers/dograh";

const payload = (over: Record<string, unknown> = {}) => ({
  transcript: TRANSCRIPT_TEXT,
  durationSeconds: 42,
  disposition: "completed",
  ...over,
});

describe("parseDograhTranscriptText", () => {
  it("maps user to candidate and assistant to interviewer, keeping ISO timestamps", () => {
    expect(parseDograhTranscriptText(TRANSCRIPT_TEXT)).toEqual([
      { role: "interviewer", text: "Tell me about database indexes.", at: "2026-11-12T10:00:01.000Z" },
      { role: "candidate", text: "An index speeds up reads at the cost of writes.", at: "2026-11-12T10:00:09.000Z" },
      { role: "interviewer", text: "Good. When would you avoid one?", at: "2026-11-12T10:00:15.000Z" },
    ]);
  });

  it("reads lines without a timestamp and ranges with an end timestamp", () => {
    const turns = parseDograhTranscriptText(
      "assistant: Hi\n[2026-11-12T10:00:09.000Z -> 2026-11-12T10:00:12.000Z] user: Hello\n",
    );
    expect(turns).toEqual([
      { role: "interviewer", text: "Hi" },
      { role: "candidate", text: "Hello", at: "2026-11-12T10:00:09.000Z" },
    ]);
  });

  it("drops a timestamp label that is not a date", () => {
    expect(parseDograhTranscriptText("[00:01.5] user: hi")).toEqual([{ role: "candidate", text: "hi" }]);
  });

  it("merges consecutive lines from the same speaker into one turn", () => {
    const turns = parseDograhTranscriptText("assistant: One.\nassistant: Two.\nuser: Yes.\nuser: Really.\n");
    expect(turns).toEqual([
      { role: "interviewer", text: "One. Two." },
      { role: "candidate", text: "Yes. Really." },
    ]);
  });

  it("joins a line without a speaker label onto the previous turn", () => {
    expect(parseDograhTranscriptText("user: first part\nsecond part\n")).toEqual([
      { role: "candidate", text: "first part second part" },
    ]);
  });

  it("returns null when the file does not start with a speaker line", () => {
    expect(parseDograhTranscriptText("<html>not a transcript</html>")).toBeNull();
    expect(parseDograhTranscriptText("system: hi")).toBeNull();
  });

  it("returns no turns for an empty file", () => {
    expect(parseDograhTranscriptText("")).toEqual([]);
    expect(parseDograhTranscriptText("\n\n")).toEqual([]);
  });

  it("collapses control characters and whitespace inside a turn", () => {
    expect(parseDograhTranscriptText("user: a\t\u0007  b   c")).toEqual([{ role: "candidate", text: "a b c" }]);
  });

  it("does not let a spoken line start a new speaker mid-text", () => {
    // Only a line start counts. Text that merely contains "assistant:" stays inside the turn.
    expect(parseDograhTranscriptText("user: she said assistant: do it")).toEqual([
      { role: "candidate", text: "she said assistant: do it" },
    ]);
  });
});

describe("endedReasonFromDisposition", () => {
  it.each([
    ["completed", "interviewer_ended"],
    ["agent_hangup", "interviewer_ended"],
    ["bot_ended_call", "interviewer_ended"],
    ["user_hangup", "user_ended"],
    ["caller_hung_up", "user_ended"],
    ["max_duration_reached", "time_limit"],
    ["TIMEOUT", "time_limit"],
    ["system_error", "error"],
    ["something_new", "interviewer_ended"],
    ["", "interviewer_ended"],
  ])("%s -> %s", (disposition, reason) => {
    expect(endedReasonFromDisposition(disposition)).toBe(reason);
  });
});

describe("dograhWebhookAdapter", () => {
  it("returns canonical turns and metadata", () => {
    const r = dograhWebhookAdapter.parse(payload());
    expect(r).toMatchObject({
      ok: true,
      value: { metadata: { source: "dograh_webhook", durationSeconds: 42, endedReason: "interviewer_ended" } },
    });
    if (r.ok) expect(r.value.transcript).toHaveLength(3);
  });

  it("accepts an empty transcript", () => {
    const r = dograhWebhookAdapter.parse(payload({ transcript: "" }));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value.transcript).toEqual([]);
  });

  it.each([
    [{ extra: 1 }, /Unknown field/],
    [{ durationSeconds: -1 }, /durationSeconds/],
    [{ durationSeconds: 3601 }, /durationSeconds/],
    [{ durationSeconds: 1.5 }, /durationSeconds/],
    [{ durationSeconds: "42" }, /durationSeconds/],
    [{ disposition: "x".repeat(65) }, /disposition/],
    [{ disposition: "a\nb" }, /disposition/],
    [{ disposition: 7 }, /disposition/],
    [{ transcript: 5 }, /transcript must be a string/],
    [{ transcript: "garbage with no speaker" }, /expected Dograh format/],
  ])("rejects %j", (over, message) => {
    const r = dograhWebhookAdapter.parse(payload(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(message);
  });

  it("rejects a payload that is not an object", () => {
    for (const bad of [null, "x", [], 3]) expect(dograhWebhookAdapter.parse(bad).ok).toBe(false);
  });

  it("is registered, and the shared limits still apply to its output", () => {
    expect(defaultAdapters.dograh_webhook).toBe(dograhWebhookAdapter);
    const long = `user: ${"word ".repeat(6000)}\n`; // > 24,000 characters in total
    const r = validateTranscriptBody(
      { source: "dograh_webhook", payload: payload({ transcript: long }) },
      defaultAdapters,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/at most/);
  });
});
