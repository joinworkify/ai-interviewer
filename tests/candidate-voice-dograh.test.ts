import { describe, expect, it, vi } from "vitest";

import { createDograhVoiceSession, type VoiceStatus } from "@/lib/candidate/voice";
import type { DograhWidgetApi } from "@/lib/dograh/widget-client";

const OPTS = {
  sessionId: "22222222-2222-4222-8222-222222222222",
  role: "Software Engineer",
  level: "mid",
  techstack: "Python, Java",
  widgetSrc: "http://localhost:9999/widget.js",
};

/** A widget whose callbacks the test can fire by hand. */
function fakeWidget(start: () => unknown = () => undefined) {
  const cb: Record<string, (...a: never[]) => void> = {};
  const widget = {
    start: vi.fn(start),
    end: vi.fn(),
    setContext: vi.fn(),
    onCallConnected: (f: () => void) => void (cb.connected = f),
    onCallDisconnected: (f: () => void) => void (cb.disconnected = f),
    onCallEnd: (f: () => void) => void (cb.end = f),
    onStatusChange: (f: (s: string) => void) => void (cb.status = f as never),
    onError: (f: () => void) => void (cb.error = f),
  };
  return { widget: widget as unknown as DograhWidgetApi & typeof widget, cb };
}

function setup(over: { session?: unknown; widget?: ReturnType<typeof fakeWidget>["widget"]; loadError?: boolean } = {}) {
  const statuses: VoiceStatus[] = [];
  const captions: string[] = [];
  const speakers: unknown[] = [];
  const widget = over.widget ?? fakeWidget().widget;
  const requestSession = vi.fn(
    async () =>
      (over.session ?? { ok: true, contextVariables: { session_token: "tok", questions: "[]" } }) as never,
  );
  const loadWidget = vi.fn(async () => {
    if (over.loadError) throw new Error("widget_unavailable");
    return widget;
  });
  const session = createDograhVoiceSession(
    {
      onStatus: (s) => statuses.push(s),
      onCaption: (c) => captions.push(c),
      onSpeaker: (s) => speakers.push(s),
    },
    { ...OPTS, requestSession, loadWidget },
  );
  return { session, statuses, captions, speakers, requestSession, loadWidget, widget };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createDograhVoiceSession", () => {
  it("requests a signed session with the attempt id, then starts the call with its context", async () => {
    const t = setup();
    expect(t.statuses).toEqual(["connecting"]);
    await flush();
    expect(t.requestSession).toHaveBeenCalledWith({
      sessionId: OPTS.sessionId,
      role: OPTS.role,
      level: OPTS.level,
      techstack: OPTS.techstack,
    });
    expect(t.loadWidget).toHaveBeenCalledWith(OPTS.widgetSrc);
    expect(t.widget.setContext).toHaveBeenCalledWith({ session_token: "tok", questions: "[]" });
    expect(t.widget.start).toHaveBeenCalledOnce();
  });

  it("reports connected, then ended when the call disconnects", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    f.cb.connected();
    f.cb.disconnected();
    expect(t.statuses).toEqual(["connecting", "connected", "ended"]);
    expect(t.speakers).toEqual([null]);
  });

  it("settles only once when both disconnect and end callbacks fire", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    f.cb.connected();
    f.cb.disconnected();
    f.cb.end();
    expect(t.statuses.filter((s) => s === "ended")).toHaveLength(1);
  });

  it("fails with the server's message when the session cannot be prepared", async () => {
    const t = setup({ session: { ok: false, status: 429, message: "Too many interview sessions." } });
    await flush();
    expect(t.statuses).toEqual(["connecting", "failed"]);
    expect(t.captions).toEqual(["Too many interview sessions."]);
    expect(t.loadWidget).not.toHaveBeenCalled();
  });

  it("fails when the widget script cannot be loaded", async () => {
    const t = setup({ loadError: true });
    await flush();
    expect(t.statuses).toEqual(["connecting", "failed"]);
    expect(t.captions[0]).toMatch(/voice service/i);
  });

  it("fails when the call ends before it ever connected", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    f.cb.end();
    expect(t.statuses).toEqual(["connecting", "failed"]);
  });

  it("fails on a widget error with a fixed message, not the raw error", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    (f.cb.error as unknown as (e: unknown) => void)(new Error("token=abc123"));
    expect(t.statuses).toEqual(["connecting", "failed"]);
    expect(t.captions.join(" ")).not.toContain("abc123");
  });

  it("fails when starting the call throws", async () => {
    const f = fakeWidget(() => {
      throw new Error("mic denied");
    });
    const t = setup({ widget: f.widget });
    await flush();
    expect(t.statuses).toEqual(["connecting", "failed"]);
  });

  it("ends the call on stop and ignores later widget callbacks", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    f.cb.connected();
    t.session.stop();
    expect(f.widget.end).toHaveBeenCalledOnce();
    f.cb.disconnected();
    expect(t.statuses).toEqual(["connecting", "connected"]);
  });

  it("does nothing more when stopped before the session was prepared", async () => {
    const t = setup();
    t.session.stop();
    await flush();
    expect(t.loadWidget).not.toHaveBeenCalled();
    expect(t.widget.start).not.toHaveBeenCalled();
    expect(t.widget.end).not.toHaveBeenCalled();
    expect(t.statuses).toEqual(["connecting"]);
  });

  it("does not end an already finished call again on stop", async () => {
    const f = fakeWidget();
    const t = setup({ widget: f.widget });
    await flush();
    f.cb.connected();
    f.cb.disconnected();
    t.session.stop();
    expect(f.widget.end).not.toHaveBeenCalled();
  });
});
