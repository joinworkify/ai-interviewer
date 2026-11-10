import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base64ToPcm16, pcm16ToBase64 } from "@/lib/gemini-live/audio";
import {
  LiveInterviewController,
  type ControllerDeps,
  type LiveCallbacksLike,
  type LiveSessionLike,
  type MicHandle,
  type PlayerLike,
  type SessionPhase,
  type TokenGrant,
} from "@/lib/gemini-live/controller";
import { TokenRequestError } from "@/lib/gemini-live/errors";
import type { LiveInterviewDetails } from "@/lib/gemini-live/interview-details";

const DETAILS: LiveInterviewDetails = {
  role: "Backend Engineer",
  level: "senior",
  techstack: ["Go"],
};
const GRANT: TokenGrant = {
  token: "auth_tokens/one",
  model: "gemini-3.8-live",
  maxSessionSeconds: 300,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeMic implements MicHandle {
  sampleRate = 48000;
  stopped = 0;
  constructor(readonly emit: (frames: Float32Array) => void) {}
  stop() {
    this.stopped++;
  }
}

class FakeSession implements LiveSessionLike {
  sent: Array<Parameters<LiveSessionLike["sendRealtimeInput"]>[0]> = [];
  toolResponses: Array<Parameters<LiveSessionLike["sendToolResponse"]>[0]> = [];
  closed = 0;
  constructor(readonly callbacks: LiveCallbacksLike) {}
  sendRealtimeInput(p: Parameters<LiveSessionLike["sendRealtimeInput"]>[0]) {
    this.sent.push(p);
  }
  sendToolResponse(p: Parameters<LiveSessionLike["sendToolResponse"]>[0]) {
    this.toolResponses.push(p);
  }
  close() {
    this.closed++;
  }
  get audio() {
    return this.sent.filter((s) => s.audio);
  }
  get texts() {
    return this.sent.filter((s) => s.text).map((s) => s.text);
  }
}

class FakePlayer implements PlayerLike {
  enqueued: Array<{ data: string; rate: number }> = [];
  cleared = 0;
  closed = 0;
  resumed = 0;
  remaining = 0;
  constructor(readonly onPlayingChange: (p: boolean) => void) {}
  async resume() {
    this.resumed++;
  }
  enqueue(data: string, rate: number) {
    this.enqueued.push({ data, rate });
    this.onPlayingChange(true);
  }
  clear() {
    this.cleared++;
    this.onPlayingChange(false);
  }
  remainingMs() {
    return this.remaining;
  }
  close() {
    this.closed++;
  }
}

interface Harness {
  controller: LiveInterviewController;
  deps: ControllerDeps;
  mics: FakeMic[];
  sessions: FakeSession[];
  players: FakePlayer[];
  phases: SessionPhase[];
  micGate: ReturnType<typeof deferred<void>> | null;
  tokenGate: ReturnType<typeof deferred<TokenGrant>> | null;
  connectGate: ReturnType<typeof deferred<void>> | null;
  tokenSignals: AbortSignal[];
  requestToken: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  connectSignals: AbortSignal[];
}

function harness(opts: { micError?: unknown } = {}): Harness {
  const h = {
    mics: [],
    sessions: [],
    players: [],
    phases: [],
    micGate: null,
    tokenGate: null,
    connectGate: null,
    tokenSignals: [],
  } as unknown as Harness;

  const startMicrophone: ControllerDeps["startMicrophone"] = async (onFrames) => {
    if (h.micGate) await h.micGate.promise;
    if (opts.micError) throw opts.micError;
    const mic = new FakeMic(onFrames);
    h.mics.push(mic);
    return mic;
  };
  h.requestToken = vi.fn(async (_details: LiveInterviewDetails, signal: AbortSignal) => {
    h.tokenSignals.push(signal);
    if (h.tokenGate) return h.tokenGate.promise;
    return GRANT;
  });
  h.connectSignals = [];
  h.connect = vi.fn(async ({ callbacks, signal }: { callbacks: LiveCallbacksLike; signal: AbortSignal }) => {
    h.connectSignals.push(signal);
    const session = new FakeSession(callbacks);
    h.sessions.push(session);
    if (h.connectGate) await h.connectGate.promise;
    return session;
  });
  h.deps = {
    startMicrophone,
    requestToken: h.requestToken as unknown as ControllerDeps["requestToken"],
    connect: h.connect as unknown as ControllerDeps["connect"],
    createPlayer: (onPlayingChange) => {
      const p = new FakePlayer(onPlayingChange);
      h.players.push(p);
      return p;
    },
    now: () => Date.now(),
  };
  h.controller = new LiveInterviewController(h.deps);
  h.controller.subscribe(() => {
    const phase = h.controller.getSnapshot().phase;
    if (h.phases[h.phases.length - 1] !== phase) h.phases.push(phase);
  });
  return h;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => {
  vi.useRealTimers();
});

async function startActive(h: Harness) {
  await h.controller.start(DETAILS);
  expect(h.controller.getSnapshot().phase).toBe("active");
  return h.sessions[h.sessions.length - 1];
}

describe("happy path", () => {
  it("goes microphone -> authorizing -> connecting -> active and kicks off the interviewer", async () => {
    const h = harness();
    const session = await startActive(h);
    expect(h.phases).toEqual(["microphone", "authorizing", "connecting", "active"]);
    expect(h.requestToken).toHaveBeenCalledWith(DETAILS, expect.any(AbortSignal));
    expect(h.connect).toHaveBeenCalledWith(
      expect.objectContaining({ token: GRANT.token, model: GRANT.model }),
    );
    expect(h.players[0].resumed).toBe(1);
    expect(session.texts).toHaveLength(1);
    expect(h.controller.getSnapshot().startedAt).toBe(1_000_000);
    expect(h.controller.getSnapshot().details).toEqual(DETAILS);
  });

  it("drops mic frames until active, then streams 16 kHz PCM16 base64 chunks", async () => {
    const h = harness();
    h.connectGate = deferred<void>();
    const starting = h.controller.start(DETAILS);
    await flush();
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    h.mics[0].emit(new Float32Array(4800).fill(0.5));
    h.connectGate.resolve();
    await starting;
    const session = h.sessions[0];
    expect(session.audio).toHaveLength(0);

    // 4800 frames @ 48 kHz = 100 ms = 1600 samples @ 16 kHz = one chunk.
    h.mics[0].emit(new Float32Array(4800).fill(0.5));
    expect(session.audio).toHaveLength(1);
    const { audio } = session.audio[0];
    expect(audio!.mimeType).toBe("audio/pcm;rate=16000");
    const pcm = base64ToPcm16(audio!.data!);
    expect(pcm.length).toBe(1600);
    expect(pcm[0]).toBe(16384);
  });

  it("enqueues every audio part of a modelTurn at its declared rate", async () => {
    const h = harness();
    const session = await startActive(h);
    const a = pcm16ToBase64(new Int16Array([1, 2]));
    const b = pcm16ToBase64(new Int16Array([3, 4]));
    session.callbacks.onmessage({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: a, mimeType: "audio/pcm;rate=24000" } },
            { text: "thinking..." },
            { inlineData: { data: b, mimeType: "audio/pcm" } },
            { inlineData: { data: "AAAA", mimeType: "image/png" } },
          ],
        },
      },
    });
    expect(h.players[0].enqueued).toEqual([
      { data: a, rate: 24000 },
      { data: b, rate: 24000 },
    ]);
    expect(h.controller.getSnapshot().interviewerSpeaking).toBe(true);
  });

  it("maintains input/output transcripts", async () => {
    const h = harness();
    const session = await startActive(h);
    const msg = (sc: object) => session.callbacks.onmessage({ serverContent: sc });
    msg({ outputTranscription: { text: "Tell me about " } });
    msg({ outputTranscription: { text: "Go channels." } });
    msg({ turnComplete: true });
    msg({ inputTranscription: { text: "They are typed pipes." } });
    const t = h.controller.getSnapshot().transcript;
    expect(t.map((e) => [e.speaker, e.text, e.final])).toEqual([
      ["interviewer", "Tell me about Go channels.", true],
      ["candidate", "They are typed pipes.", false],
    ]);
  });
});

describe("barge-in", () => {
  it("stops and clears queued output immediately on interrupted", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: "AAAA", mimeType: "audio/pcm;rate=24000" } }] },
        outputTranscription: { text: "Let me ask" },
      },
    });
    session.callbacks.onmessage({ serverContent: { interrupted: true } });
    expect(h.players[0].cleared).toBe(1);
    const snap = h.controller.getSnapshot();
    expect(snap.interviewerSpeaking).toBe(false);
    expect(snap.transcript[0]).toMatchObject({ final: true, interrupted: true });
    expect(snap.phase).toBe("active");
  });
});

describe("ending and cleanup", () => {
  it("End while waiting for the microphone: no token request, late mic is stopped", async () => {
    const h = harness();
    h.micGate = deferred<void>();
    const starting = h.controller.start(DETAILS);
    await flush();
    h.controller.end();
    expect(h.controller.getSnapshot().phase).toBe("ended");
    h.micGate.resolve();
    await starting;
    expect(h.mics[0].stopped).toBe(1);
    expect(h.requestToken).not.toHaveBeenCalled();
    expect(h.players[0].closed).toBe(1);
    expect(h.controller.getSnapshot().phase).toBe("ended");
  });

  it("End while the token is in flight: aborts it, never connects, stops the mic", async () => {
    const h = harness();
    h.tokenGate = deferred<TokenGrant>();
    const starting = h.controller.start(DETAILS);
    await flush();
    expect(h.controller.getSnapshot().phase).toBe("authorizing");
    h.controller.end();
    expect(h.tokenSignals[0].aborted).toBe(true);
    expect(h.mics[0].stopped).toBe(1);
    h.tokenGate.resolve(GRANT);
    await starting;
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().phase).toBe("ended");
  });

  it("End while connecting: the late session is closed and never activated", async () => {
    const h = harness();
    h.connectGate = deferred<void>();
    const starting = h.controller.start(DETAILS);
    await flush();
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    h.controller.end();
    h.connectGate.resolve();
    await starting;
    const session = h.sessions[0];
    expect(session.closed).toBe(1);
    expect(session.sent).toHaveLength(0);
    expect(h.mics[0].stopped).toBe(1);
    expect(h.controller.getSnapshot().phase).toBe("ended");
  });

  it("End while active tears everything down and finalizes the transcript", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onmessage({ serverContent: { inputTranscription: { text: "partial" } } });
    h.controller.end();
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("ended");
    expect(snap.endedAt).toBe(1_000_000);
    expect(snap.transcript.every((e) => e.final)).toBe(true);
    expect(session.closed).toBe(1);
    expect(h.mics[0].stopped).toBe(1);
    expect(h.players[0].closed).toBe(1);
    // Close event caused by our own close() is ignored.
    session.callbacks.onclose({ code: 1000, reason: "" });
    expect(h.controller.getSnapshot().phase).toBe("ended");
    expect(h.controller.getSnapshot().error).toBeNull();
    // Mic frames after end go nowhere.
    h.mics[0].emit(new Float32Array(4800));
    expect(session.audio).toHaveLength(0);
  });

  it("dispose() (unmount) cleans up an active session and ignores late events", async () => {
    const h = harness();
    const session = await startActive(h);
    h.controller.dispose();
    expect(session.closed).toBe(1);
    expect(h.mics[0].stopped).toBe(1);
    session.callbacks.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } },
    });
    expect(h.players[0].enqueued).toHaveLength(0);
  });
});

describe("connect cancellation signal", () => {
  it("passes a live AbortSignal to connect and aborts it on End while connecting", async () => {
    const h = harness();
    h.connectGate = deferred<void>();
    const starting = h.controller.start(DETAILS);
    await flush();
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    const signal = h.connectSignals[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    h.controller.end();
    expect(signal.aborted).toBe(true);
    h.connectGate.resolve();
    await starting;
  });

  it("aborts the connect signal on unmount (dispose) while connecting", async () => {
    const h = harness();
    h.connectGate = deferred<void>();
    const starting = h.controller.start(DETAILS);
    await flush();
    h.controller.dispose();
    expect(h.connectSignals[0].aborted).toBe(true);
    h.connectGate.resolve();
    await starting;
  });

  it("keeps the signal un-aborted while active, aborts it on End", async () => {
    const h = harness();
    await startActive(h);
    const signal = h.connectSignals[0];
    expect(signal.aborted).toBe(false);
    h.controller.end();
    expect(signal.aborted).toBe(true);
  });

  it("uses a fresh signal per attempt", async () => {
    const h = harness();
    await startActive(h);
    h.controller.end();
    await startActive(h);
    expect(h.connectSignals).toHaveLength(2);
    expect(h.connectSignals[0]).not.toBe(h.connectSignals[1]);
    expect(h.connectSignals[1].aborted).toBe(false);
  });

  it("reports an aborted/timeout connect rejection as an error only for the current attempt", async () => {
    const h = harness();
    h.connect.mockRejectedValueOnce(new Error("Gemini Live setup timed out after 15s."));
    await h.controller.start(DETAILS);
    expect(h.controller.getSnapshot().error).toMatch(/timed out/);
    expect(h.mics[0].stopped).toBe(1);
  });
});

describe("audio output unavailable", () => {
  it("createPlayer throwing (no AudioContext) -> UI error, no rejection, nothing acquired", async () => {
    const h = harness();
    const startMic = vi.spyOn(h.deps, "startMicrophone");
    h.deps.createPlayer = () => {
      throw new ReferenceError("AudioContext is not defined");
    };
    await expect(h.controller.start(DETAILS)).resolves.toBe(false);
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.error).toMatch(/audio playback/i);
    expect(startMic).not.toHaveBeenCalled();
    expect(h.requestToken).not.toHaveBeenCalled();
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("player.resume() rejecting does not produce an unhandled rejection", async () => {
    const h = harness();
    const original = h.deps.createPlayer;
    h.deps.createPlayer = (cb) => {
      const p = original(cb);
      p.resume = () => Promise.reject(new Error("not allowed"));
      return p;
    };
    await expect(h.controller.start(DETAILS)).resolves.toBe(true);
  });

  it("can start again after the audio API becomes available", async () => {
    const h = harness();
    const original = h.deps.createPlayer;
    h.deps.createPlayer = () => {
      throw new Error("NotSupportedError");
    };
    await h.controller.start(DETAILS);
    h.deps.createPlayer = original;
    await expect(h.controller.start(DETAILS)).resolves.toBe(true);
  });
});

describe("errors", () => {
  it("microphone denial -> error, no token requested, player closed", async () => {
    const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    const h = harness({ micError: denied });
    await h.controller.start(DETAILS);
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.error).toMatch(/microphone/i);
    expect(h.requestToken).not.toHaveBeenCalled();
    expect(h.players[0].closed).toBe(1);
  });

  it("token failure -> error with the server message, mic released", async () => {
    const h = harness();
    h.requestToken.mockRejectedValueOnce(
      new TokenRequestError("Gemini Live is not configured on the server.", 503),
    );
    await h.controller.start(DETAILS);
    expect(h.controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "Gemini Live is not configured on the server.",
    });
    expect(h.mics[0].stopped).toBe(1);
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("connect failure -> error, mic released", async () => {
    const h = harness();
    h.connect.mockRejectedValueOnce(new Error("Live connection closed before setup completed (code 1008): bad"));
    await h.controller.start(DETAILS);
    expect(h.controller.getSnapshot().phase).toBe("error");
    expect(h.controller.getSnapshot().error).toMatch(/connect/i);
    expect(h.mics[0].stopped).toBe(1);
  });

  it("unexpected server close while active -> error and cleanup", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onclose({ code: 1011, reason: "Internal error occurred." });
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.error).toMatch(/1011/);
    expect(h.mics[0].stopped).toBe(1);
    expect(h.players[0].closed).toBe(1);
  });

  it("websocket error while active -> error", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onerror({ message: "socket broke" });
    expect(h.controller.getSnapshot().phase).toBe("error");
    expect(session.closed).toBe(1);
  });

  it("goAway sets a notice without ending", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onmessage({ goAway: { timeLeft: "10s" } });
    expect(h.controller.getSnapshot().phase).toBe("active");
    expect(h.controller.getSnapshot().notice).toMatch(/disconnect/i);
  });
});

describe("retries and stale completions", () => {
  it("ignores Start while a session is starting or active", async () => {
    const h = harness();
    h.tokenGate = deferred<TokenGrant>();
    const first = h.controller.start(DETAILS);
    await flush();
    expect(await h.controller.start(DETAILS)).toBe(false);
    h.tokenGate.resolve(GRANT);
    await first;
    expect(await h.controller.start(DETAILS)).toBe(false);
    expect(h.requestToken).toHaveBeenCalledTimes(1);
  });

  it("restart after End never resurrects the old attempt", async () => {
    const h = harness();
    const firstGate = deferred<void>();
    h.connectGate = firstGate;
    const first = h.controller.start(DETAILS);
    await flush();
    expect(h.controller.getSnapshot().phase).toBe("connecting");
    h.controller.end();

    h.connectGate = null;
    await h.controller.start(DETAILS); // second attempt becomes active
    expect(h.controller.getSnapshot().phase).toBe("active");
    const [oldSession, newSession] = h.sessions;

    // Now the first connect finally resolves: it must be closed, not adopted.
    firstGate.resolve();
    expect(await first).toBe(false);
    expect(oldSession.closed).toBe(1);
    expect(newSession.closed).toBe(0);
    expect(h.controller.getSnapshot().phase).toBe("active");
    // Late events from the abandoned session do not affect the new one.
    oldSession.callbacks.onclose({ code: 1006, reason: "" });
    expect(h.controller.getSnapshot().phase).toBe("active");
    expect(h.mics.filter((m) => m.stopped === 0)).toHaveLength(1);
  });

  it("can start again after an error", async () => {
    const h = harness();
    h.requestToken.mockRejectedValueOnce(new TokenRequestError("busy", 503));
    await h.controller.start(DETAILS);
    expect(h.controller.getSnapshot().phase).toBe("error");
    await h.controller.start(DETAILS);
    expect(h.controller.getSnapshot()).toMatchObject({ phase: "active", error: null });
    expect(h.sessions).toHaveLength(1);
  });
});

describe("end_interview tool and time limit", () => {
  it("responds to end_interview, stops the mic, lets the closing play, then ends", async () => {
    const h = harness();
    const session = await startActive(h);
    h.players[0].remaining = 2500;
    session.callbacks.onmessage({
      toolCall: {
        functionCalls: [{ id: "call-1", name: "end_interview", args: { reason: "completed" } }],
      },
    });
    expect(session.toolResponses).toEqual([
      {
        functionResponses: [
          { id: "call-1", name: "end_interview", response: { output: { ended: true } } },
        ],
      },
    ]);
    expect(h.controller.getSnapshot().phase).toBe("closing");
    expect(h.mics[0].stopped).toBe(1);

    // Closing speech still arriving/playing keeps the session open.
    session.callbacks.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } },
    });
    expect(h.players[0].enqueued).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.controller.getSnapshot().phase).toBe("closing");
    h.players[0].remaining = 0;
    await vi.advanceTimersByTimeAsync(1000);
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("ended");
    expect(snap.notice).toMatch(/interviewer ended/i);
    expect(session.closed).toBe(1);
  });

  it("caps the closing phase even if audio never drains", async () => {
    const h = harness();
    const session = await startActive(h);
    h.players[0].remaining = 60_000;
    session.callbacks.onmessage({
      toolCall: { functionCalls: [{ id: "c", name: "end_interview", args: {} }] },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.controller.getSnapshot().phase).toBe("ended");
  });

  it("answers unknown tools with an error and keeps going", async () => {
    const h = harness();
    const session = await startActive(h);
    session.callbacks.onmessage({
      toolCall: { functionCalls: [{ id: "x", name: "delete_db", args: {} }] },
    });
    expect(session.toolResponses[0].functionResponses[0]).toMatchObject({
      id: "x",
      name: "delete_db",
      response: { error: expect.any(String) },
    });
    expect(h.controller.getSnapshot().phase).toBe("active");
  });

  it("sends a wrap-up notice 30 s before the cap and hard-stops at 5 minutes", async () => {
    const h = harness();
    const session = await startActive(h);
    await vi.advanceTimersByTimeAsync(269_000);
    expect(session.texts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.texts).toHaveLength(2);
    expect(session.texts[1]).toMatch(/30 seconds/);
    await vi.advanceTimersByTimeAsync(30_000);
    const snap = h.controller.getSnapshot();
    expect(snap.phase).toBe("ended");
    expect(snap.notice).toMatch(/5-minute/);
    expect(session.closed).toBe(1);
    expect(h.mics[0].stopped).toBe(1);
  });

  it("uses a shorter cap if the server grants one", async () => {
    const h = harness();
    h.requestToken.mockResolvedValueOnce({ ...GRANT, maxSessionSeconds: 60 });
    await h.controller.start(DETAILS);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.controller.getSnapshot().phase).toBe("ended");
  });
});
