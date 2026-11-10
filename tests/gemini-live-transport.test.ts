import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLiveUrl,
  buildSetupMessage,
  connectLiveTransport,
  LIVE_WS_ENDPOINT,
  type WebSocketLike,
} from "@/lib/gemini-live/live-transport";
import type { LiveCallbacksLike, LiveMessageLike } from "@/lib/gemini-live/controller";

/**
 * Exercises the real native-WebSocket transport against a fake socket. No
 * network. Wire formats mirror @google/genai 3.0.0 (dist/web/index.mjs:
 * liveConnectParametersToMldev, Session.sendRealtimeInput,
 * tLiveClienttToolResponse, handleWebSocketMessage).
 */

const TOKEN = "auth_tokens/abc.DEF-123_x";
const MODEL = "gemini-3.8-live";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType = "blob";
  sent: string[] = [];
  closeCalls: Array<[number | undefined, string | undefined]> = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    if (this.readyState !== 1) throw new Error("InvalidStateError: not open");
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closeCalls.push([code, reason]);
    if (this.readyState < 2) this.readyState = 2;
  }
  // --- test drivers (simulate the browser/server) ---
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverMessage(data: unknown) {
    this.onmessage?.({ data });
  }
  serverError() {
    this.onerror?.({});
  }
  serverClose(code = 1006, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

let sockets: FakeSocket[];
const factory = (url: string) => {
  const s = new FakeSocket(url);
  sockets.push(s);
  return s;
};

function callbacks() {
  const messages: LiveMessageLike[] = [];
  const errors: Array<{ message?: string }> = [];
  const closes: Array<{ code?: number; reason?: string }> = [];
  const cb: LiveCallbacksLike = {
    onmessage: (m) => messages.push(m),
    onerror: (e) => errors.push(e),
    onclose: (e) => closes.push(e),
  };
  return { cb, messages, errors, closes };
}

const SETUP_COMPLETE = JSON.stringify({ setupComplete: { sessionId: "s1" } });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function connect(opts: { signal?: AbortSignal; setupTimeoutMs?: number } = {}) {
  const c = callbacks();
  const promise = connectLiveTransport({
    token: TOKEN,
    model: MODEL,
    callbacks: c.cb,
    signal: opts.signal ?? new AbortController().signal,
    setupTimeoutMs: opts.setupTimeoutMs ?? 5000,
    createWebSocket: factory,
  });
  return { ...c, promise };
}

async function established() {
  const c = connect();
  sockets[0].serverOpen();
  sockets[0].serverMessage(SETUP_COMPLETE);
  const session = await c.promise;
  return { ...c, session, socket: sockets[0] };
}

describe("URL and setup wire format", () => {
  it("targets the v1beta constrained endpoint with an encoded access_token", () => {
    expect(LIVE_WS_ENDPOINT).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
    );
    expect(buildLiveUrl(TOKEN)).toBe(
      `${LIVE_WS_ENDPOINT}?access_token=auth_tokens%2Fabc.DEF-123_x`,
    );
  });

  it.each(["AIzaSy-real-api-key", "auth_tokens/", "auth_tokens/a b", "auth_tokens/x&key=y", ""])(
    "refuses non-ephemeral or malformed token %j",
    (t) => {
      expect(() => buildLiveUrl(t)).toThrow();
    },
  );

  it("builds the SDK-equivalent setup message (camelCase, models/ prefix)", () => {
    expect(JSON.stringify(buildSetupMessage(MODEL))).toBe(
      '{"setup":{"model":"models/gemini-3.8-live","generationConfig":{"responseModalities":["AUDIO"]},"inputAudioTranscription":{},"outputAudioTranscription":{}}}',
    );
    expect(buildSetupMessage("models/x-live").setup.model).toBe("models/x-live");
    expect(() => buildSetupMessage("a/../b")).toThrow();
    expect(() => buildSetupMessage("x?key=1")).toThrow();
  });

  it("sends setup once the socket opens", async () => {
    connect();
    const s = sockets[0];
    expect(s.url).toBe(buildLiveUrl(TOKEN));
    expect(s.sent).toEqual([]);
    s.serverOpen();
    expect(s.sent).toEqual([JSON.stringify(buildSetupMessage(MODEL))]);
  });
});

describe("cancellation during establishment", () => {
  it("honours an already-aborted signal without creating a socket", async () => {
    const ac = new AbortController();
    ac.abort();
    const c = connect({ signal: ac.signal });
    await expect(c.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(sockets).toHaveLength(0);
  });

  it("abort while CONNECTING closes the underlying socket and rejects", async () => {
    const ac = new AbortController();
    const c = connect({ signal: ac.signal });
    const s = sockets[0];
    ac.abort();
    await expect(c.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(s.closeCalls).toHaveLength(1);
    // A late open from the browser must not send setup on a cancelled socket.
    s.readyState = 1;
    s.onopen?.({});
    expect(s.sent).toEqual([]);
  });

  it("abort after the socket opened but before setupComplete closes it", async () => {
    const ac = new AbortController();
    const c = connect({ signal: ac.signal });
    const s = sockets[0];
    s.serverOpen();
    ac.abort();
    await expect(c.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(s.closeCalls).toHaveLength(1);
    s.serverMessage(SETUP_COMPLETE);
    await flush();
    expect(c.messages).toEqual([]);
  });

  it("never-arriving setupComplete times out and closes the socket", async () => {
    const c = connect({ setupTimeoutMs: 5000 });
    const s = sockets[0];
    s.serverOpen();
    const assertion = expect(c.promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(4999);
    expect(s.closeCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(s.closeCalls).toHaveLength(1);
    s.serverMessage(SETUP_COMPLETE);
    s.serverClose(1000);
    await flush();
    expect(c.messages).toEqual([]);
    expect(c.closes).toEqual([]);
  });

  it("times out even if the socket never opens", async () => {
    const c = connect({ setupTimeoutMs: 3000 });
    const assertion = expect(c.promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(sockets[0].closeCalls).toHaveLength(1);
  });

  it("socket error before setup rejects and closes", async () => {
    const c = connect();
    sockets[0].serverError();
    await expect(c.promise).rejects.toThrow(/before setup/i);
    expect(sockets[0].closeCalls).toHaveLength(1);
    expect(c.errors).toEqual([]);
  });

  it("server close before setup rejects with the close code", async () => {
    const c = connect();
    sockets[0].serverOpen();
    sockets[0].serverClose(1008, "Invalid token");
    await expect(c.promise).rejects.toThrow(/1008.*Invalid token/);
    expect(c.closes).toEqual([]);
  });

  it("malformed frame before setup rejects and closes", async () => {
    const c = connect();
    sockets[0].serverOpen();
    sockets[0].serverMessage("{not json");
    await expect(c.promise).rejects.toThrow(/invalid message/i);
    expect(sockets[0].closeCalls).toHaveLength(1);
  });

  it("clears the setup timer once established (no late timeout close)", async () => {
    const { socket } = await established();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.closeCalls).toHaveLength(0);
  });
});

describe("controller + real transport", () => {
  async function makeController(setupTimeoutMs = 5000) {
    const { LiveInterviewController } = await import("@/lib/gemini-live/controller");
    const mic = { sampleRate: 48000, stops: 0, stop() { this.stops++; } };
    const controller = new LiveInterviewController({
      startMicrophone: async () => mic,
      requestToken: async () => ({ token: TOKEN, model: MODEL, maxSessionSeconds: 300 }),
      connect: (args) => connectLiveTransport({ ...args, setupTimeoutMs, createWebSocket: factory }),
      createPlayer: () => ({
        resume: async () => {},
        enqueue: () => {},
        clear: () => {},
        remainingMs: () => 0,
        close: () => {},
      }),
    });
    return { controller, mic };
  }
  const details = { role: "SRE", level: "mid" as const, techstack: ["Go"] };

  it("End during a stalled setup closes the real socket immediately", async () => {
    const { controller, mic } = await makeController();
    const starting = controller.start(details);
    await flush();
    expect(controller.getSnapshot().phase).toBe("connecting");
    sockets[0].serverOpen(); // open, but setupComplete never arrives
    controller.end();
    expect(sockets[0].closeCalls).toHaveLength(1);
    expect(await starting).toBe(false);
    expect(controller.getSnapshot().phase).toBe("ended");
    expect(mic.stops).toBe(1);
  });

  it("a setup that never completes becomes a UI error and the socket is closed", async () => {
    const { controller } = await makeController(4000);
    const starting = controller.start(details);
    await flush();
    sockets[0].serverOpen();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await starting).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ phase: "error" });
    expect(controller.getSnapshot().error).toMatch(/timed out/i);
    expect(sockets[0].closeCalls).toHaveLength(1);
  });

  it("successful setup sends the kickoff text over the real socket; End closes once", async () => {
    const { controller } = await makeController();
    const starting = controller.start(details);
    await flush();
    sockets[0].serverOpen();
    sockets[0].serverMessage(SETUP_COMPLETE);
    expect(await starting).toBe(true);
    expect(sockets[0].sent[1]).toMatch(/^\{"realtimeInput":\{"text":"/);
    controller.end();
    controller.dispose();
    expect(sockets[0].closeCalls).toHaveLength(1);
  });
});

describe("established session", () => {
  it("encodes realtimeInput and toolResponse exactly like the SDK", async () => {
    const { session, socket } = await established();
    socket.sent = [];
    session.sendRealtimeInput({ audio: { data: "AAA=", mimeType: "audio/pcm;rate=16000" } });
    session.sendRealtimeInput({ text: "Begin." });
    session.sendRealtimeInput({ audioStreamEnd: true });
    session.sendToolResponse({
      functionResponses: [
        { id: "c1", name: "end_interview", response: { output: { ended: true } } },
      ],
    });
    expect(socket.sent).toEqual([
      '{"realtimeInput":{"audio":{"data":"AAA=","mimeType":"audio/pcm;rate=16000"}}}',
      '{"realtimeInput":{"text":"Begin."}}',
      '{"realtimeInput":{"audioStreamEnd":true}}',
      '{"toolResponse":{"functionResponses":[{"id":"c1","name":"end_interview","response":{"output":{"ended":true}}}]}}',
    ]);
  });

  it("validates outgoing payloads like the SDK", async () => {
    const { session } = await established();
    expect(() =>
      session.sendRealtimeInput({ audio: { data: "x", mimeType: "image/png" } }),
    ).toThrow(/mime/i);
    expect(() => session.sendToolResponse({ functionResponses: [] })).toThrow();
    expect(() =>
      session.sendToolResponse({ functionResponses: [{ name: "end_interview", response: {} }] }),
    ).toThrow(/id/);
  });

  it("parses string, Blob and ArrayBuffer frames and delivers them in order", async () => {
    const { messages, socket } = await established();
    const enc = (o: object) => JSON.stringify(o);
    socket.serverMessage(new Blob([enc({ serverContent: { outputTranscription: { text: "A" } } })]));
    socket.serverMessage(enc({ serverContent: { outputTranscription: { text: "B" } } }));
    socket.serverMessage(
      new TextEncoder().encode(enc({ serverContent: { outputTranscription: { text: "C" } } })).buffer,
    );
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(messages.map((m) => m.serverContent?.outputTranscription?.text)).toEqual(["A", "B", "C"]);
  });

  it("forwards every part of a modelTurn untouched", async () => {
    const { messages, socket } = await established();
    const parts = [
      { inlineData: { data: "AQI=", mimeType: "audio/pcm;rate=24000" } },
      { text: "t" },
      { inlineData: { data: "AwQ=", mimeType: "audio/pcm;rate=24000" } },
    ];
    socket.serverMessage(JSON.stringify({ serverContent: { modelTurn: { parts } } }));
    await flush();
    expect(messages[0].serverContent?.modelTurn?.parts).toEqual(parts);
  });

  it("delivers messages that arrive right behind setupComplete", async () => {
    const c = connect();
    const s = sockets[0];
    s.serverOpen();
    s.serverMessage(new Blob([SETUP_COMPLETE]));
    s.serverMessage(JSON.stringify({ serverContent: { turnComplete: true } }));
    await c.promise;
    await flush();
    expect(c.messages).toEqual([{ serverContent: { turnComplete: true } }]);
  });

  it("ignores malformed or non-object frames after setup without throwing", async () => {
    const { messages, socket, errors } = await established();
    socket.serverMessage("{bad");
    socket.serverMessage("42");
    socket.serverMessage(JSON.stringify({ goAway: { timeLeft: "5s" } }));
    await flush();
    expect(messages).toEqual([{ goAway: { timeLeft: "5s" } }]);
    expect(errors).toEqual([]);
  });

  it("reports server close and socket error to the callbacks", async () => {
    const a = await established();
    a.socket.serverError();
    expect(a.errors).toHaveLength(1);
    a.socket.serverClose(1011, "Internal error");
    expect(a.closes).toEqual([{ code: 1011, reason: "Internal error" }]);
    expect(() => a.session.sendRealtimeInput({ text: "x" })).toThrow();
  });

  it("close() is idempotent and silences later socket events", async () => {
    const { session, socket, closes, messages } = await established();
    session.close();
    session.close();
    expect(socket.closeCalls).toEqual([[1000, "client closed"]]);
    socket.serverMessage(JSON.stringify({ serverContent: { turnComplete: true } }));
    socket.serverClose(1000);
    await flush();
    expect(closes).toEqual([]);
    expect(messages).toEqual([]);
    expect(() => session.sendRealtimeInput({ text: "x" })).toThrow(/closed/i);
  });

  it("aborting the signal after setup closes the socket", async () => {
    const ac = new AbortController();
    const c = connect({ signal: ac.signal });
    sockets[0].serverOpen();
    sockets[0].serverMessage(SETUP_COMPLETE);
    await c.promise;
    ac.abort();
    expect(sockets[0].closeCalls).toHaveLength(1);
  });
});
