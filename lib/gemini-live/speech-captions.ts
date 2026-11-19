/**
 * Live captions of the candidate from the browser's own speech recognition
 * (Chrome and Safari). Gemini Live's built-in input transcription arrives late,
 * in pieces, and often mishears short or accented answers; the browser's
 * recognizer shows words as they are spoken and is far more accurate for
 * English. It only listens: the interview audio still goes to Gemini.
 */

export interface SpeechCaptions {
  /** Starts listening; a no-op when already listening. */
  start(): void;
  /** Stops listening and drops anything not yet final. */
  stop(): void;
  readonly listening: boolean;
}

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export function speechCaptionsSupported(win: Window = window): boolean {
  const w = win as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Returns null when the browser has no speech recognition. */
export function createSpeechCaptions(
  onText: (text: string, final: boolean) => void,
  /** Called once when the recognizer cannot work (blocked, no network, unsupported). */
  onFail: () => void = () => {},
  win: Window = window,
): SpeechCaptions | null {
  const w = win as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let recognition: RecognitionLike | null = null;
  let wanted = false;
  let denied = false;

  const open = () => {
    if (!wanted || denied || recognition) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (text) onText(text, e.results[i].isFinal);
      }
    };
    r.onerror = (e) => {
      // "no-speech" and "aborted" are normal; the rest mean it cannot work here.
      if (e.error && e.error !== "no-speech" && e.error !== "aborted" && !denied) {
        denied = true;
        onFail();
      }
    };
    r.onend = () => {
      recognition = null;
      // Chrome ends a session after a pause in speech; keep listening.
      if (wanted && !denied) setTimeout(open, 150);
    };
    recognition = r;
    try {
      r.start();
    } catch {
      recognition = null;
    }
  };

  return {
    start() {
      wanted = true;
      open();
    },
    stop() {
      wanted = false;
      const r = recognition;
      recognition = null;
      if (r) {
        r.onend = null;
        try {
          r.abort();
        } catch {
          // already stopped
        }
      }
    },
    get listening() {
      return recognition !== null;
    },
  };
}
