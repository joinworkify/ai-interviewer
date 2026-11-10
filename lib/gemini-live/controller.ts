import { INPUT_MIME_TYPE, MicChunkEncoder, parsePcmSampleRate } from "./audio";
import {
  describeCloseEvent,
  describeMicError,
  sanitizeProviderText,
  TokenRequestError,
} from "./errors";
import {
  END_INTERVIEW_TOOL,
  MAX_SESSION_SECONDS,
  type LiveInterviewDetails,
} from "./interview-details";
import {
  initialTranscript,
  reduceTranscript,
  type TranscriptEntry,
  type TranscriptEvent,
  type TranscriptState,
} from "./transcript";

/**
 * Framework-agnostic lifecycle for one browser Gemini Live interview.
 *
 *   idle -> microphone -> authorizing -> connecting -> active
 *        -> (closing) -> ended | error        (Start again from ended/error)
 *
 * Every async step belongs to an "attempt". End/unmount/failure bump the
 * attempt counter, tear down whatever is held, and any step that completes
 * afterwards sees it is stale and releases what it produced (late mic stream
 * stopped, late session closed) instead of adopting it. This prevents late
 * sessions and microphone leaks across retries.
 *
 * Order rationale: the microphone is requested first so a denied permission
 * never spends an ephemeral token (and Google quota).
 */

export type SessionPhase =
  | "idle"
  | "microphone"
  | "authorizing"
  | "connecting"
  | "active"
  | "closing"
  | "ended"
  | "error";

export interface ControllerState {
  phase: SessionPhase;
  error: string | null;
  notice: string | null;
  transcript: TranscriptEntry[];
  startedAt: number | null;
  endedAt: number | null;
  interviewerSpeaking: boolean;
  details: LiveInterviewDetails | null;
}

export interface TokenGrant {
  token: string;
  model: string;
  maxSessionSeconds: number;
}

/** Subset of `LiveServerMessage` (@google/genai) used here. */
export interface LiveMessageLike {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }>;
    };
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
  };
  toolCall?: {
    functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
  };
  goAway?: { timeLeft?: string };
}

export interface LiveCallbacksLike {
  onmessage: (message: LiveMessageLike) => void;
  onerror: (e: { message?: string }) => void;
  onclose: (e: { code?: number; reason?: string }) => void;
}

/** Subset of the SDK `Session` used here. */
export interface LiveSessionLike {
  sendRealtimeInput(params: {
    audio?: { data?: string; mimeType?: string };
    text?: string;
    audioStreamEnd?: boolean;
  }): void;
  sendToolResponse(params: {
    functionResponses: Array<{ id?: string; name?: string; response?: Record<string, unknown> }>;
  }): void;
  close(): void;
}

export interface MicHandle {
  readonly sampleRate: number;
  stop(): void;
}

export interface PlayerLike {
  resume(): Promise<void>;
  enqueue(base64: string, sampleRate: number): void;
  clear(): void;
  remainingMs(): number;
  close(): void;
}

export interface ControllerDeps {
  startMicrophone(onFrames: (frames: Float32Array) => void): Promise<MicHandle>;
  requestToken(details: LiveInterviewDetails, signal: AbortSignal): Promise<TokenGrant>;
  /**
   * Opens the Live socket. Must close the underlying transport when `signal`
   * aborts — before or after setup — and reject if aborted during setup.
   */
  connect(args: {
    token: string;
    model: string;
    callbacks: LiveCallbacksLike;
    signal: AbortSignal;
  }): Promise<LiveSessionLike>;
  createPlayer(onPlayingChange: (playing: boolean) => void): PlayerLike;
  now?: () => number;
}

export const WRAP_UP_LEAD_MS = 30_000;
const CLOSING_GRACE_MS = 1_200;
const CLOSING_MAX_MS = 10_000;

const KICKOFF_TEXT =
  "The candidate has joined and is ready. Begin the interview now.";
const WRAP_UP_TEXT =
  "Time notice: about 30 seconds remain in this session. Do not ask a new question. Give one short polite closing sentence now, then call end_interview.";

const STARTABLE: ReadonlySet<SessionPhase> = new Set(["idle", "ended", "error"]);
const IN_PROGRESS: ReadonlySet<SessionPhase> = new Set([
  "microphone",
  "authorizing",
  "connecting",
  "active",
  "closing",
]);

const INITIAL_STATE: ControllerState = {
  phase: "idle",
  error: null,
  notice: null,
  transcript: [],
  startedAt: null,
  endedAt: null,
  interviewerSpeaking: false,
  details: null,
};

interface Resources {
  player?: PlayerLike;
  mic?: MicHandle;
  encoder?: MicChunkEncoder;
  abort?: AbortController;
  session?: LiveSessionLike;
  timers: ReturnType<typeof setTimeout>[];
}

export class LiveInterviewController {
  private state: ControllerState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private attempt = 0;
  private res: Resources = { timers: [] };
  private transcript: TranscriptState = initialTranscript();
  private readonly now: () => number;

  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? Date.now;
  }

  // --- external store API (useSyncExternalStore-compatible) ---------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ControllerState => this.state;

  // --- commands --------------------------------------------------------------

  /** Resolves true once the session is active; false if not started/aborted/failed. */
  async start(details: LiveInterviewDetails): Promise<boolean> {
    if (!STARTABLE.has(this.state.phase)) return false;
    const attempt = ++this.attempt;
    const stale = () => attempt !== this.attempt;

    this.transcript = initialTranscript();
    this.res = { timers: [] };
    this.set({
      ...INITIAL_STATE,
      phase: "microphone",
      details,
    });

    // Created synchronously inside the click handler so autoplay allows
    // output. Missing/unsupported Web Audio (no AudioContext, too many
    // contexts, etc.) becomes a UI error before any mic or token is acquired.
    let player: PlayerLike;
    try {
      player = this.deps.createPlayer((playing) => {
        if (!stale()) this.set({ interviewerSpeaking: playing });
      });
    } catch {
      this.fail(
        "Audio playback is not available in this browser (Web Audio API missing or blocked). Try a recent Chrome, Edge, Firefox or Safari.",
      );
      return false;
    }
    this.res.player = player;
    try {
      void player.resume().catch(() => {});
    } catch {
      // A synchronous throw from resume() is non-fatal; playback may still start.
    }

    // 1. Microphone (permission prompt).
    let mic: MicHandle;
    try {
      mic = await this.deps.startMicrophone((frames) => this.onFrames(attempt, frames));
    } catch (err) {
      if (!stale()) this.fail(describeMicError(err));
      return false;
    }
    if (stale()) {
      mic.stop();
      return false;
    }
    this.res.mic = mic;
    this.res.encoder = new MicChunkEncoder(mic.sampleRate);

    // 2. One-use ephemeral token from our server.
    this.set({ phase: "authorizing" });
    const abort = new AbortController();
    this.res.abort = abort;
    let grant: TokenGrant;
    try {
      grant = await this.deps.requestToken(details, abort.signal);
    } catch (err) {
      if (!stale()) {
        this.fail(
          err instanceof TokenRequestError
            ? err.message
            : "Could not start the interview session.",
        );
      }
      return false;
    }
    if (stale()) return false;

    // 3. Live websocket (setup is constrained by the token server-side).
    //    The signal stays held for the whole session: End/unmount/failure
    //    abort it via teardown(), which cancels a pending setup and closes
    //    the real socket even if connect() never resolves.
    const connectAbort = new AbortController();
    this.res.abort = connectAbort;
    this.set({ phase: "connecting" });
    let session: LiveSessionLike;
    try {
      session = await this.deps.connect({
        token: grant.token,
        model: grant.model,
        callbacks: this.callbacksFor(attempt),
        signal: connectAbort.signal,
      });
    } catch (err) {
      if (!stale()) {
        const detail = err instanceof Error ? sanitizeProviderText(err.message) : "";
        this.fail(`Could not connect to Gemini Live${detail ? `: ${detail}` : "."}`);
      }
      return false;
    }
    if (stale()) {
      safeClose(session);
      return false;
    }
    this.res.session = session;

    // 4. Active: arm the hard cap and kick off the interviewer's greeting.
    this.set({ phase: "active", startedAt: this.now() });
    const capSeconds =
      grant.maxSessionSeconds > 0
        ? Math.min(grant.maxSessionSeconds, MAX_SESSION_SECONDS)
        : MAX_SESSION_SECONDS;
    const capMs = capSeconds * 1000;
    if (capMs > WRAP_UP_LEAD_MS * 2) {
      this.timer(() => {
        if (!stale() && this.state.phase === "active") {
          this.send({ text: WRAP_UP_TEXT });
        }
      }, capMs - WRAP_UP_LEAD_MS);
    }
    this.timer(() => {
      if (!stale()) {
        this.finish(
          `Reached the ${Math.round(capSeconds / 60)}-minute prototype session limit.`,
        );
      }
    }, capMs);
    this.send({ text: KICKOFF_TEXT });
    return true;
  }

  /** End button: valid while connecting, active or closing. */
  end(): void {
    if (IN_PROGRESS.has(this.state.phase)) this.finish("You ended the interview.");
  }

  /** Unmount cleanup. The controller stays reusable (React StrictMode remounts). */
  dispose(): void {
    if (IN_PROGRESS.has(this.state.phase)) {
      this.finish("The interview page was closed.");
    } else {
      this.attempt++;
      this.teardown();
    }
  }

  // --- internals -------------------------------------------------------------

  private set(patch: Partial<ControllerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private timer(fn: () => void, ms: number) {
    this.res.timers.push(setTimeout(fn, Math.max(0, ms)));
  }

  private send(params: Parameters<LiveSessionLike["sendRealtimeInput"]>[0]) {
    try {
      this.res.session?.sendRealtimeInput(params);
    } catch {
      // Socket already closing; onclose will report it.
    }
  }

  private teardown() {
    const res = this.res;
    this.res = { timers: [] };
    for (const t of res.timers) clearTimeout(t);
    res.abort?.abort();
    try {
      res.mic?.stop();
    } catch {
      // ignore
    }
    if (res.session) safeClose(res.session);
    try {
      res.player?.close();
    } catch {
      // ignore
    }
  }

  private settle(patch: Partial<ControllerState>) {
    this.attempt++; // invalidate every pending step and callback
    this.teardown();
    this.transcript = reduceTranscript(this.transcript, { type: "finalizeAll" });
    this.set({
      ...patch,
      transcript: this.transcript.entries,
      endedAt: this.now(),
      interviewerSpeaking: false,
    });
  }

  private finish(notice: string) {
    this.settle({ phase: "ended", notice });
  }

  private fail(error: string) {
    this.settle({ phase: "error", error });
  }

  private onFrames(attempt: number, frames: Float32Array) {
    if (attempt !== this.attempt || this.state.phase !== "active") return;
    const { encoder, session } = this.res;
    if (!encoder || !session) return;
    for (const data of encoder.push(frames)) {
      this.send({ audio: { data, mimeType: INPUT_MIME_TYPE } });
    }
  }

  private callbacksFor(attempt: number): LiveCallbacksLike {
    const current = () => attempt === this.attempt;
    return {
      onmessage: (message) => {
        if (current()) this.onMessage(message);
      },
      onerror: (e) => {
        // During connect the SDK rejects connect(); handled there.
        if (!current() || this.state.phase === "connecting") return;
        const detail = e?.message ? `: ${sanitizeProviderText(e.message)}` : ".";
        this.fail(`Gemini Live connection error${detail}`);
      },
      onclose: (e) => {
        if (!current() || this.state.phase === "connecting") return;
        if (this.state.phase === "closing") {
          this.finish("The interviewer ended the interview.");
        } else {
          this.fail(describeCloseEvent(e ?? {}));
        }
      },
    };
  }

  private onMessage(message: LiveMessageLike) {
    const phase = this.state.phase;
    if (phase !== "connecting" && phase !== "active" && phase !== "closing") return;

    const sc = message.serverContent;
    if (sc) {
      const events: TranscriptEvent[] = [];
      if (sc.interrupted) {
        // Barge-in: drop queued interviewer audio immediately.
        this.res.player?.clear();
        events.push({ type: "interrupted" });
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        const blob = part.inlineData;
        if (!blob?.data) continue;
        if (blob.mimeType && !blob.mimeType.toLowerCase().startsWith("audio/pcm")) continue;
        this.res.player?.enqueue(blob.data, parsePcmSampleRate(blob.mimeType));
      }
      if (sc.inputTranscription) {
        events.push({
          type: "input",
          text: sc.inputTranscription.text ?? "",
          finished: sc.inputTranscription.finished,
        });
      }
      if (sc.outputTranscription) {
        events.push({
          type: "output",
          text: sc.outputTranscription.text ?? "",
          finished: sc.outputTranscription.finished,
        });
      }
      if (sc.turnComplete) events.push({ type: "turnComplete" });
      if (events.length > 0) {
        const next = events.reduce(reduceTranscript, this.transcript);
        if (next !== this.transcript) {
          this.transcript = next;
          this.set({ transcript: next.entries });
        }
      }
    }

    const calls = message.toolCall?.functionCalls;
    if (calls && calls.length > 0) this.onToolCall(calls);

    if (message.goAway) {
      this.set({
        notice: `Gemini will disconnect soon${
          message.goAway.timeLeft ? ` (time left: ${message.goAway.timeLeft})` : ""
        }. Seamless reconnection is not implemented in this prototype.`,
      });
    }
  }

  private onToolCall(
    calls: NonNullable<NonNullable<LiveMessageLike["toolCall"]>["functionCalls"]>,
  ) {
    const session = this.res.session;
    if (!session) return;
    let endRequested = false;
    const functionResponses = calls.map((call) => {
      if (call.name === END_INTERVIEW_TOOL) {
        endRequested = true;
        return { id: call.id, name: call.name, response: { output: { ended: true } } };
      }
      return {
        id: call.id,
        name: call.name,
        response: { error: `Unknown function: ${String(call.name).slice(0, 64)}` },
      };
    });
    try {
      session.sendToolResponse({ functionResponses });
    } catch {
      // Socket closing; onclose handles it.
    }
    if (endRequested && this.state.phase === "active") this.beginClosing();
  }

  /** Let the closing sentence finish playing, then end. Mic is released now. */
  private beginClosing() {
    const attempt = this.attempt;
    try {
      this.res.mic?.stop();
    } catch {
      // ignore
    }
    this.res.mic = undefined;
    this.res.encoder = undefined;
    this.set({ phase: "closing" });

    const deadline = this.now() + CLOSING_MAX_MS;
    const check = (first: boolean) => {
      if (attempt !== this.attempt) return;
      const now = this.now();
      const remaining = this.res.player?.remainingMs() ?? 0;
      if (now >= deadline || (!first && remaining <= 0)) {
        this.finish("The interviewer ended the interview.");
        return;
      }
      const wait = Math.min(
        Math.max(first ? CLOSING_GRACE_MS : 100, remaining + 150),
        deadline - now,
      );
      this.timer(() => check(false), wait);
    };
    check(true);
  }
}

function safeClose(session: LiveSessionLike) {
  try {
    session.close();
  } catch {
    // already closed
  }
}
