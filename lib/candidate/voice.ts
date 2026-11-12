/**
 * Live interview voice session. SHH owns the real voice WebSocket; the live
 * screen only talks to this interface, so the fake below can be swapped out.
 */

export type VoiceStatus = "connecting" | "connected" | "reconnecting" | "ended" | "failed";
export type Speaker = "interviewer" | "candidate" | null;

export interface VoiceHandlers {
  onStatus(status: VoiceStatus): void;
  onSpeaker(speaker: Speaker): void;
  onCaption(text: string): void;
}

export interface VoiceSession {
  stop(): void;
}

export const FAKE_SCRIPT = [
  "Hi, thanks for joining. Can you briefly introduce yourself?",
  "Tell me about a bug you fixed recently. How did you find the cause?",
  "How do you decide what to test when you add a new feature?",
];

interface FakeOptions {
  script?: string[];
  /** Simulate one connection drop after the first question (for demos). */
  dropOnce?: boolean;
  /** Milliseconds per speaking turn. */
  turnMs?: number;
}

/** shortcut: scripted fake with no audio; replace with SHH's WebSocket client. */
export function createFakeVoiceSession(handlers: VoiceHandlers, opts: FakeOptions = {}): VoiceSession {
  const { script = FAKE_SCRIPT, dropOnce = false, turnMs = 4000 } = opts;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let at = 0;
  const later = (fn: () => void, ms: number) => {
    at += ms;
    timers.push(setTimeout(fn, at));
  };

  handlers.onStatus("connecting");
  later(() => handlers.onStatus("connected"), 1000);
  script.forEach((question, i) => {
    later(() => {
      handlers.onSpeaker("interviewer");
      handlers.onCaption(question);
    }, 0);
    later(() => {
      handlers.onSpeaker("candidate");
      handlers.onCaption("(listening to your answer...)");
    }, turnMs);
    if (dropOnce && i === 0) {
      later(() => {
        handlers.onSpeaker(null);
        handlers.onStatus("reconnecting");
      }, turnMs);
      later(() => handlers.onStatus("connected"), 5000);
    } else {
      later(() => handlers.onSpeaker(null), turnMs);
    }
  });
  later(() => {
    handlers.onCaption("That's all the questions. Thank you!");
    handlers.onStatus("ended");
  }, 0);

  return {
    stop() {
      timers.forEach(clearTimeout);
    },
  };
}
