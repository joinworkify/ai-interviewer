import type { LiveCallbacksLike, LiveMessageLike, LiveSessionLike } from "./controller";

/**
 * Minimal native-WebSocket transport for the Gemini Live API (browser).
 *
 * Why not `ai.live.connect` from @google/genai: the SDK exposes no
 * cancellable handle until `setupComplete`, so if setup stalls, End/unmount
 * cannot close the socket. Here the socket exists from the first line, and
 * abort, a bounded setup timeout, errors and closes all go through one
 * idempotent cleanup that really closes the socket.
 *
 * Wire formats mirror @google/genai 3.0.0 (dist/web/index.mjs):
 *  - URL:      Live.connect -> `${ws base}/ws/google.ai.generativelanguage.${v}.
 *              GenerativeService.BidiGenerateContentConstrained?access_token=…`
 *  - setup:    liveConnectParametersToMldev + liveConnectConfigToMldev$1
 *              {"setup":{"model":"models/…","generationConfig":{"responseModalities":[…]},
 *               "inputAudioTranscription":{},"outputAudioTranscription":{}}}
 *  - input:    Session.sendRealtimeInput -> {"realtimeInput":{audio|audioStreamEnd|text}}
 *  - tools:    tLiveClienttToolResponse -> {"toolResponse":{"functionResponses":[…]}}
 *  - incoming: handleWebSocketMessage — Blob.text() / TextDecoder(ArrayBuffer) /
 *              string, then JSON.parse; fields are already camelCase.
 *
 * The server-minted ephemeral token locks model/prompt/tools/transcription
 * (see lib/gemini-live/prompt.ts); the setup sent here only mirrors the
 * non-secret parts and cannot widen them.
 */

export const LIVE_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
export const DEFAULT_SETUP_TIMEOUT_MS = 15_000;

const TOKEN_RE = /^auth_tokens\/[A-Za-z0-9._-]{1,512}$/;
const MODEL_RE = /^[A-Za-z0-9._/-]{1,128}$/;

/** Structural subset of the DOM WebSocket. */
export interface WebSocketLike {
  readonly readyState: number;
  binaryType?: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const WS_OPEN = 1;

export function buildLiveUrl(token: string): string {
  if (!TOKEN_RE.test(token)) {
    throw new Error("Refusing to connect: not an ephemeral auth token.");
  }
  return `${LIVE_WS_ENDPOINT}?access_token=${encodeURIComponent(token)}`;
}

/** Same normalization as the SDK's tModel() for the Developer API. */
export function buildSetupMessage(model: string) {
  if (!MODEL_RE.test(model) || model.includes("..")) {
    throw new Error("Invalid model id.");
  }
  const name =
    model.startsWith("models/") || model.startsWith("tunedModels/")
      ? model
      : `models/${model}`;
  return {
    setup: {
      model: name,
      generationConfig: { responseModalities: ["AUDIO"] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

type RealtimeParams = Parameters<LiveSessionLike["sendRealtimeInput"]>[0];
type ToolParams = Parameters<LiveSessionLike["sendToolResponse"]>[0];

function encodeRealtimeInput(params: RealtimeParams): string {
  const realtimeInput: Record<string, unknown> = {};
  if (params.audio != null) {
    const mime = params.audio.mimeType;
    if (typeof mime !== "string" || !mime.startsWith("audio/")) {
      throw new Error(`Unsupported mime type: ${String(mime)}`);
    }
    realtimeInput.audio = { data: params.audio.data, mimeType: mime };
  }
  if (params.audioStreamEnd != null) realtimeInput.audioStreamEnd = params.audioStreamEnd;
  if (params.text != null) realtimeInput.text = params.text;
  return JSON.stringify({ realtimeInput });
}

function encodeToolResponse(params: ToolParams): string {
  const list = params?.functionResponses;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("functionResponses is required.");
  }
  for (const r of list) {
    if (!r || typeof r !== "object" || !("name" in r) || !("response" in r)) {
      throw new Error("Could not parse function response.");
    }
    if (!("id" in r) || r.id === undefined) {
      throw new Error("Function response requires an id (Gemini Developer API).");
    }
  }
  return JSON.stringify({ toolResponse: { functionResponses: list } });
}

function abortError(): Error {
  const err = new Error("The Live connection was cancelled.");
  err.name = "AbortError";
  return err;
}

async function decodeFrame(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  throw new Error("Unsupported frame type.");
}

function parseMessage(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function connectLiveTransport(args: {
  token: string;
  model: string;
  callbacks: LiveCallbacksLike;
  signal: AbortSignal;
  setupTimeoutMs?: number;
  createWebSocket: WebSocketFactory;
}): Promise<LiveSessionLike> {
  const { callbacks, signal } = args;
  return new Promise<LiveSessionLike>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    // Validate before any socket exists.
    let url: string;
    let setupJson: string;
    try {
      url = buildLiveUrl(args.token);
      setupJson = JSON.stringify(buildSetupMessage(args.model));
    } catch (err) {
      reject(err);
      return;
    }

    let state: "connecting" | "established" | "closed" = "connecting";
    const early: Record<string, unknown>[] = [];
    let chain: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const ws = args.createWebSocket(url);
    try {
      ws.binaryType = "arraybuffer";
    } catch {
      // Blob frames are handled too.
    }

    const detach = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      signal.removeEventListener("abort", onAbort);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    };

    const closeSocket = (reason: string) => {
      try {
        ws.close(1000, reason);
      } catch {
        // already closing/closed
      }
    };

    /** Establishment failed: idempotent, always closes the real socket. */
    const failSetup = (err: Error) => {
      if (state !== "connecting") return;
      state = "closed";
      detach();
      closeSocket("setup aborted");
      reject(err);
    };

    /** Client-initiated close after setup: idempotent and silent. */
    const closeSession = () => {
      if (state === "closed") return;
      state = "closed";
      detach();
      closeSocket("client closed");
    };

    function onAbort() {
      if (state === "connecting") failSetup(abortError());
      else closeSession();
    }

    const session: LiveSessionLike = {
      sendRealtimeInput(params) {
        const payload = encodeRealtimeInput(params);
        if (state !== "established" || ws.readyState !== WS_OPEN) {
          throw new Error("Gemini Live session is closed.");
        }
        ws.send(payload);
      },
      sendToolResponse(params) {
        const payload = encodeToolResponse(params);
        if (state !== "established" || ws.readyState !== WS_OPEN) {
          throw new Error("Gemini Live session is closed.");
        }
        ws.send(payload);
      },
      close: closeSession,
    };

    const handleText = (text: string) => {
      if (state === "closed") return;
      const message = parseMessage(text);
      if (state === "connecting") {
        if (!message) {
          failSetup(new Error("Gemini Live sent an invalid message during setup."));
          return;
        }
        if (!("setupComplete" in message)) {
          early.push(message);
          return;
        }
        state = "established";
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        resolve(session);
        for (const m of early.splice(0)) {
          if (state !== "established") break;
          callbacks.onmessage(m as LiveMessageLike);
        }
        return;
      }
      // Established: ignore malformed/non-object frames.
      if (message) callbacks.onmessage(message as LiveMessageLike);
    };

    ws.onopen = () => {
      if (state !== "connecting") return;
      try {
        ws.send(setupJson);
      } catch {
        failSetup(new Error("Could not send Live setup."));
      }
    };
    ws.onmessage = (ev) => {
      const data = ev?.data;
      // Serialize decoding so async Blob reads cannot reorder frames.
      chain = chain
        .then(() => decodeFrame(data))
        .then(handleText, () => {
          if (state === "connecting") {
            failSetup(new Error("Gemini Live sent an invalid message during setup."));
          }
        })
        .catch(() => {
          // Callback errors must not become unhandled rejections or stall the chain.
        });
    };
    ws.onerror = () => {
      if (state === "connecting") {
        failSetup(new Error("Live connection failed before setup completed."));
      } else if (state === "established") {
        callbacks.onerror({ message: "WebSocket error" });
      }
    };
    ws.onclose = (ev) => {
      const code = typeof ev?.code === "number" ? ev.code : 1006;
      const reason = typeof ev?.reason === "string" ? ev.reason : "";
      if (state === "connecting") {
        failSetup(
          new Error(
            `Live connection closed before setup completed (code ${code})${reason ? `: ${reason}` : "."}`,
          ),
        );
      } else if (state === "established") {
        state = "closed";
        detach();
        callbacks.onclose({ code, reason });
      }
    };

    signal.addEventListener("abort", onAbort);
    const timeoutMs = args.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;
    timer = setTimeout(() => {
      failSetup(
        new Error(`Gemini Live setup timed out after ${Math.round(timeoutMs / 1000)}s.`),
      );
    }, timeoutMs);
  });
}
