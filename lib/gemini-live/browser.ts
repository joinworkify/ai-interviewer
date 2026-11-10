import type {
  ControllerDeps,
  LiveCallbacksLike,
  LiveSessionLike,
  MicHandle,
  PlayerLike,
} from "./controller";
import { MicUnavailableError } from "./errors";
import {
  connectLiveTransport,
  DEFAULT_SETUP_TIMEOUT_MS,
  type WebSocketLike,
} from "./live-transport";
import { PcmPlayer, type AudioContextLike } from "./player";
import { requestLiveToken } from "./token-client";

/**
 * Browser-only adapters for LiveInterviewController. Import only from client
 * components; nothing here runs at module load. The browser does not use
 * @google/genai (the SDK is only used server-side to mint tokens).
 */

const WORKLET_URL = "/worklets/pcm-capture-processor.js";
const WORKLET_NAME = "pcm-capture-processor";

export async function startBrowserMicrophone(
  onFrames: (frames: Float32Array) => void,
): Promise<MicHandle> {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioWorkletNode === "undefined"
  ) {
    throw new MicUnavailableError();
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  // Device-rate context: Firefox refuses to connect a mic stream into a
  // context with a different sample rate, so resampling is done in JS.
  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit", // downmix to mono
    });
    // Keep the worklet pulled by the graph without making the mic audible.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.port.onmessage = (event: MessageEvent) => {
      if (event.data instanceof Float32Array) onFrames(event.data);
    };
    source.connect(node);
    node.connect(sink);
    sink.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();

    const context = ctx;
    let stopped = false;
    return {
      sampleRate: context.sampleRate,
      stop() {
        if (stopped) return;
        stopped = true;
        node.port.onmessage = null;
        try {
          source.disconnect();
          node.disconnect();
          sink.disconnect();
        } catch {
          // already disconnected
        }
        node.port.close();
        for (const track of stream.getTracks()) track.stop();
        void context.close().catch(() => {});
      },
    };
  } catch (err) {
    for (const track of stream.getTracks()) track.stop();
    void ctx?.close().catch(() => {});
    throw err;
  }
}

export function createBrowserPlayer(
  onPlayingChange: (playing: boolean) => void,
): PlayerLike {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function") {
    throw new Error("Web Audio API (AudioContext) is not available.");
  }
  const ctx = new window.AudioContext();
  return new PcmPlayer(ctx as unknown as AudioContextLike, onPlayingChange);
}

/**
 * Native WebSocket transport (lib/gemini-live/live-transport.ts) instead of
 * `ai.live.connect`, so setup can be cancelled and bounded. `WebSocket` is
 * looked up at call time (test harnesses may replace it).
 */
export function connectGeminiLive(args: {
  token: string;
  model: string;
  callbacks: LiveCallbacksLike;
  signal: AbortSignal;
}): Promise<LiveSessionLike> {
  if (typeof globalThis.WebSocket !== "function") {
    return Promise.reject(new Error("WebSockets are not supported in this browser."));
  }
  return connectLiveTransport({
    ...args,
    setupTimeoutMs: DEFAULT_SETUP_TIMEOUT_MS,
    createWebSocket: (url) => new globalThis.WebSocket(url) as unknown as WebSocketLike,
  });
}

export const browserControllerDeps: ControllerDeps = {
  startMicrophone: startBrowserMicrophone,
  requestToken: requestLiveToken,
  connect: connectGeminiLive,
  createPlayer: createBrowserPlayer,
};
