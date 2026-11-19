import { afterEach, describe, expect, it, vi } from "vitest";

import { createCaptionTracker, MAX_CAPTION_CHARS, type CaptionSpeaker } from "@/lib/dograh/captions";
import { listenToCallMessages, type DograhWidgetApi } from "@/lib/dograh/widget-client";

function setup() {
  const captions: string[] = [];
  const speakers: CaptionSpeaker[] = [];
  const tracker = createCaptionTracker({
    onCaption: (t) => captions.push(t),
    onSpeaker: (s) => speakers.push(s),
  });
  const send = (type: string, payload: unknown = {}) => tracker.handle(JSON.stringify({ type, payload }));
  return { captions, speakers, tracker, send };
}

describe("createCaptionTracker", () => {
  it("builds the interviewer's caption from the chunks of one spoken turn", () => {
    const t = setup();
    t.send("rtf-bot-text", { text: "Hi, thanks" });
    t.send("rtf-bot-text", { text: "for joining." });
    expect(t.captions).toEqual(["Hi, thanks", "Hi, thanks for joining."]);
    expect(t.speakers).toEqual(["interviewer", "interviewer"]);
  });

  it("starts a new caption after the interviewer stops speaking", () => {
    const t = setup();
    t.send("rtf-bot-text", { text: "First question?" });
    t.send("rtf-bot-stopped-speaking");
    t.send("rtf-bot-text", { text: "Second question?" });
    expect(t.captions).toEqual(["First question?", "Second question?"]);
  });

  it("starts a new caption after the candidate spoke, and keeps the old one on screen meanwhile", () => {
    const t = setup();
    t.send("rtf-bot-text", { text: "Tell me about a bug." });
    t.send("rtf-user-transcription", { text: "Well, once", final: false });
    t.send("rtf-user-transcription", { text: "Well, once I fixed a race.", final: true });
    expect(t.captions).toEqual(["Tell me about a bug."]); // the candidate's words are not captioned
    expect(t.speakers.at(-1)).toBe("candidate");
    t.send("rtf-bot-text", { text: "Nice. How did you find it?" });
    expect(t.captions.at(-1)).toBe("Nice. How did you find it?");
  });

  it("marks whose turn it is from the speaking events", () => {
    const t = setup();
    t.send("rtf-bot-started-speaking");
    t.send("rtf-bot-stopped-speaking");
    expect(t.speakers).toEqual(["interviewer", "candidate"]);
    expect(t.captions).toEqual([]);
  });

  it("does not put a space before punctuation chunks", () => {
    const t = setup();
    t.send("rtf-bot-text", { text: "Hello" });
    t.send("rtf-bot-text", { text: "," });
    t.send("rtf-bot-text", { text: "it" });
    t.send("rtf-bot-text", { text: "'s" });
    t.send("rtf-bot-text", { text: "nice" });
    t.send("rtf-bot-text", { text: "." });
    expect(t.captions.at(-1)).toBe("Hello, it's nice.");
  });

  it("keeps only the most recent words of a very long turn", () => {
    const t = setup();
    for (let i = 0; i < 200; i++) t.send("rtf-bot-text", { text: `word${i}` });
    const last = t.captions.at(-1) as string;
    expect(last.length).toBeLessThanOrEqual(MAX_CAPTION_CHARS + 1); // + the leading ellipsis
    expect(last.startsWith("…")).toBe(true);
    expect(last.endsWith("word199")).toBe(true);
  });

  it("ignores events it does not know, bad JSON and empty or non-string text", () => {
    const t = setup();
    t.tracker.handle("not json");
    t.tracker.handle("null");
    t.tracker.handle('"a string"');
    t.send("rtf-ttfb-metric", { ttfb_seconds: 0.2 });
    t.send("rtf-node-transition", { node_name: "Main" });
    t.send("rtf-function-call-start", { function_name: "end_call" });
    t.send("rtf-bot-text", { text: "   " });
    t.send("rtf-bot-text", { text: 42 });
    t.send("rtf-bot-text", null);
    t.send("answer", { sdp: "v=0..." });
    expect(t.captions).toEqual([]);
    expect(t.speakers).toEqual([]);
  });
});

/** A stand-in for a WebSocket: only what the listener uses. */
function fakeSocket() {
  const listeners = new Set<(e: { data?: unknown }) => void>();
  return {
    addEventListener: vi.fn((_t: string, fn: (e: { data?: unknown }) => void) => void listeners.add(fn)),
    removeEventListener: vi.fn((_t: string, fn: (e: { data?: unknown }) => void) => void listeners.delete(fn)),
    emit: (data: unknown) => listeners.forEach((fn) => fn({ data })),
    count: () => listeners.size,
  };
}

describe("listenToCallMessages", () => {
  afterEach(() => vi.useRealTimers());

  it("attaches to the widget's socket right away when it exists and forwards text messages", () => {
    const ws = fakeSocket();
    const widget = { getState: () => ({ ws }) } as unknown as DograhWidgetApi;
    const seen: string[] = [];
    listenToCallMessages(widget, (d) => seen.push(d));
    ws.emit("hello");
    ws.emit(new ArrayBuffer(4)); // binary frames are not captions
    expect(seen).toEqual(["hello"]);
  });

  it("waits for the socket to appear after start() creates it", () => {
    vi.useFakeTimers();
    const ws = fakeSocket();
    let state: { ws: unknown } = { ws: null };
    const widget = { getState: () => state } as unknown as DograhWidgetApi;
    const seen: string[] = [];
    listenToCallMessages(widget, (d) => seen.push(d), { intervalMs: 50 });
    expect(ws.count()).toBe(0);
    vi.advanceTimersByTime(120);
    state = { ws };
    vi.advanceTimersByTime(60);
    ws.emit("late");
    expect(seen).toEqual(["late"]);
  });

  it("stops listening and stops looking when told to", () => {
    vi.useFakeTimers();
    const ws = fakeSocket();
    let state: { ws: unknown } = { ws };
    const widget = { getState: () => state } as unknown as DograhWidgetApi;
    const seen: string[] = [];
    const stop = listenToCallMessages(widget, (d) => seen.push(d));
    stop();
    ws.emit("after stop");
    expect(seen).toEqual([]);
    expect(ws.removeEventListener).toHaveBeenCalledOnce();

    // Cancelled before the socket existed: it never attaches later.
    const ws2 = fakeSocket();
    state = { ws: null };
    const stop2 = listenToCallMessages(widget, (d) => seen.push(d), { intervalMs: 50 });
    stop2();
    state = { ws: ws2 };
    vi.advanceTimersByTime(500);
    expect(ws2.count()).toBe(0);
  });

  it("gives up quietly after the timeout", () => {
    vi.useFakeTimers();
    const getState = vi.fn(() => ({ ws: null }));
    listenToCallMessages({ getState } as unknown as DograhWidgetApi, () => {}, { intervalMs: 100, timeoutMs: 1000 });
    vi.advanceTimersByTime(5000);
    const calls = getState.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(getState.mock.calls.length).toBe(calls);
  });

  it("does nothing, without throwing, when the widget has no getState or it throws", () => {
    expect(() => listenToCallMessages({} as DograhWidgetApi, () => {}, { timeoutMs: 0 })).not.toThrow();
    const throwing = {
      getState: () => {
        throw new Error("boom");
      },
    } as unknown as DograhWidgetApi;
    expect(() => listenToCallMessages(throwing, () => {}, { timeoutMs: 0 })).not.toThrow();
  });
});
