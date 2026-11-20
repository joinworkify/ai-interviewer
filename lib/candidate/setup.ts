/** Mic check state on the "Check your setup" screen. */
export type MicState = "idle" | "checking" | "ok" | "blocked" | "unsupported" | "silent";

/** Speaker test state: the tone is played and the microphone listens for it. */
export type SpeakerState = "idle" | "playing" | "ok" | "failed";

/** Start is enabled only when the mic and the speaker both pass; otherwise say what to fix. */
export function setupGate(mic: MicState, speaker: SpeakerState): { canStart: boolean; fix: string | null } {
  switch (mic) {
    case "ok":
      break;
    case "idle":
      return { canStart: false, fix: "Fix: test your microphone" };
    case "checking":
      return { canStart: false, fix: "Checking your microphone..." };
    case "blocked":
      return { canStart: false, fix: "Fix: allow microphone access" };
    case "unsupported":
      return { canStart: false, fix: "Fix: use Chrome on a laptop" };
    case "silent":
      return { canStart: false, fix: "Fix: we can't hear you. Speak, or pick another mic" };
  }
  switch (speaker) {
    case "ok":
      return { canStart: true, fix: null };
    case "idle":
      return { canStart: false, fix: "Fix: test your speaker with Play sound" };
    case "playing":
      return { canStart: false, fix: "Playing the test sound..." };
    case "failed":
      return { canStart: false, fix: "Fix: we didn't pick up the test sound. Turn up the volume, or confirm you heard it" };
  }
}

/** Seconds a dropped candidate has to reconnect before the attempt is incomplete. */
export const RECONNECT_SECONDS = 60;

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
