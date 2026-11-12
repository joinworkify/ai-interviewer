import type { GeminiLiveClientPayload } from "@/lib/transcripts/adapters/gemini-live-client";
import { putTranscript, type SaveTranscriptOutcome } from "@/lib/transcripts/client";
import { fitToLimits } from "@/lib/transcripts/limits";

import type { ControllerState } from "./controller";

/**
 * Saves the finished Gemini Live transcript to the linked interview session.
 * The controller settles once per attempt (End, hard cap, interviewer end,
 * connection error, unmount, tab close), and each attempt is sent once.
 */

export type SendTranscript = (args: {
  sessionId: string;
  payload: GeminiLiveClientPayload;
}) => Promise<SaveTranscriptOutcome>;

const sendToServer: SendTranscript = ({ sessionId, payload }) =>
  putTranscript({ sessionId, source: "client_gemini_live", payload });

/** Null until the session has started and settled. */
export function buildGeminiPayload(state: ControllerState): GeminiLiveClientPayload | null {
  const settled = state.phase === "ended" || state.phase === "error";
  if (!settled || state.startedAt === null || state.endedAt === null || !state.endReason) {
    return null;
  }
  const entries = fitToLimits(
    state.transcript
      .map((e) => ({
        speaker: e.speaker,
        text: e.text.trim(),
        ...(e.interrupted ? { interrupted: true } : {}),
      }))
      .filter((e) => e.text.length > 0),
  );
  return {
    entries,
    durationSeconds: Math.max(0, Math.round((state.endedAt - state.startedAt) / 1000)),
    endedReason: state.endReason,
  };
}

interface ControllerLike {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ControllerState;
}

/** Returns a function that stops listening. */
export function attachTranscriptSync(
  controller: ControllerLike,
  options: {
    sessionId: string;
    onOutcome?: (outcome: SaveTranscriptOutcome) => void;
    send?: SendTranscript;
  },
): () => void {
  const send = options.send ?? sendToServer;
  const sent = new Set<number>();

  const check = () => {
    const state = controller.getSnapshot();
    const payload = buildGeminiPayload(state);
    if (!payload || state.startedAt === null || sent.has(state.startedAt)) return;
    sent.add(state.startedAt);
    void send({ sessionId: options.sessionId, payload }).then(options.onOutcome);
  };

  return controller.subscribe(check);
}
