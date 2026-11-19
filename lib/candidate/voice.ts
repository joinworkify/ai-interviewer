/**
 * Live interview voice session. The live screen only talks to this interface,
 * so the voice backend can be swapped: `createDograhVoiceSession` runs a real
 * Dograh call, `createFakeVoiceSession` is a scripted stand-in for local work
 * without Dograh.
 */

import { createCaptionTracker } from "@/lib/dograh/captions";
import {
  listenToCallMessages,
  loadDograhWidget,
  requestDograhSession,
  type DograhSessionRequest,
} from "@/lib/dograh/widget-client";

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

export interface DograhVoiceOptions extends DograhSessionRequest {
  /** URL of the Dograh widget script (NEXT_PUBLIC_DOGRAH_WIDGET_SRC). */
  widgetSrc: string;
  /** Injectable for tests. */
  requestSession?: typeof requestDograhSession;
  loadWidget?: typeof loadDograhWidget;
}

/**
 * A real call through the Dograh widget. The server signs the call context
 * (POST /api/dograh/session), the widget runs the call, and Dograh posts the
 * transcript to our webhook when it ends. The widget's own callbacks only
 * cover status changes, so live captions and the speaker come from the call's
 * WebSocket (see lib/dograh/captions.ts); a failure is explained through
 * onCaption.
 */
export function createDograhVoiceSession(
  handlers: VoiceHandlers,
  options: DograhVoiceOptions,
): VoiceSession {
  const { widgetSrc, requestSession = requestDograhSession, loadWidget = loadDograhWidget } = options;
  let stopped = false;
  let finished = false;
  let connected = false;
  let started = false;
  let widget: Awaited<ReturnType<typeof loadDograhWidget>> | null = null;
  let stopListening: (() => void) | null = null;

  const finish = (status: "ended" | "failed", message?: string) => {
    if (stopped || finished) return;
    finished = true;
    stopListening?.();
    stopListening = null;
    if (message) handlers.onCaption(message);
    handlers.onSpeaker(null);
    handlers.onStatus(status);
  };

  handlers.onStatus("connecting");

  void (async () => {
    const session = await requestSession({
      sessionId: options.sessionId,
      role: options.role,
      level: options.level,
      techstack: options.techstack,
    });
    if (stopped) return;
    if (!session.ok) return finish("failed", session.message);

    try {
      widget = await loadWidget(widgetSrc);
    } catch {
      return finish("failed", "Could not load the voice service. Please try again.");
    }
    if (stopped) return;

    // The widget has no way to unsubscribe; these callbacks check the flags
    // above so a stopped or finished session ignores them.
    widget.onCallConnected?.(() => {
      if (stopped || finished) return;
      connected = true;
      handlers.onStatus("connected");
    });
    widget.onCallDisconnected?.(() => finish("ended"));
    widget.onCallEnd?.(() =>
      connected ? finish("ended") : finish("failed", "The call could not be started."),
    );
    widget.onStatusChange?.((status) => {
      if (status === "failed") finish("failed", "The voice connection failed.");
    });
    // The raw error can quote request details; show a fixed message.
    widget.onError?.(() => finish("failed", "The voice call failed."));

    // Start listening before start(): the call's WebSocket is created inside
    // it, and the first thing the interviewer says arrives soon after.
    const captions = createCaptionTracker(handlers);
    stopListening = listenToCallMessages(widget, (raw) => {
      if (stopped || finished) return;
      captions.handle(raw);
    });

    try {
      widget.setContext(session.contextVariables);
      started = true;
      await widget.start();
    } catch {
      finish("failed", "The call could not be started. Check your microphone and try again.");
    }
  })();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      stopListening?.();
      stopListening = null;
      if (started && !finished) {
        try {
          widget?.end();
        } catch {
          // The page is going away; nothing to report.
        }
      }
    },
  };
}
