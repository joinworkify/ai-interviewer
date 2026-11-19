/**
 * Live captions for a Dograh call.
 *
 * Dograh's browser widget has no caption API, but the call's signaling
 * WebSocket carries the same live events the Dograh dashboard uses for its
 * "Live Transcript" panel:
 *
 *   rtf-bot-text                { text }          a chunk of what the AI says
 *   rtf-bot-started-speaking    {}
 *   rtf-bot-stopped-speaking    {}
 *   rtf-user-transcription      { text, final }   the candidate's speech
 *
 * This file turns those messages into the two things the live screen shows:
 * the interviewer's current sentence(s) as a caption, and who is speaking. It
 * has no browser or React imports so it can be tested on its own.
 *
 * Only the interviewer's words are shown as captions. The candidate's own
 * speech just switches the speaker, so the last question stays on screen while
 * they answer.
 */

export type CaptionSpeaker = "interviewer" | "candidate" | null;

export interface CaptionHandlers {
  onCaption(text: string): void;
  onSpeaker(speaker: CaptionSpeaker): void;
}

/** Longest caption kept on screen. A longer turn shows its most recent words. */
export const MAX_CAPTION_CHARS = 500;

/** Punctuation that belongs to the previous chunk, so no space is added before it. */
const ATTACHES_TO_PREVIOUS = /^[.,!?;:)\]'’”…]/;

function appendChunk(current: string, chunk: string): string {
  if (!current) return chunk;
  return ATTACHES_TO_PREVIOUS.test(chunk) ? current + chunk : `${current} ${chunk}`;
}

function lastWords(text: string): string {
  if (text.length <= MAX_CAPTION_CHARS) return text;
  const tail = text.slice(-MAX_CAPTION_CHARS);
  const firstSpace = tail.indexOf(" ");
  return `…${firstSpace === -1 ? tail : tail.slice(firstSpace + 1)}`;
}

function payloadText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const text = (payload as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface CaptionTracker {
  /** Feed one raw WebSocket message. Anything that is not a caption event is ignored. */
  handle(raw: string): void;
}

export function createCaptionTracker(handlers: CaptionHandlers): CaptionTracker {
  let botText = "";
  // True while the interviewer is still in the middle of one spoken turn. The
  // next chunk after that turn ended starts a fresh caption instead of
  // piling onto the old one.
  let botTurnOpen = false;

  const closeBotTurn = () => {
    botTurnOpen = false;
  };

  return {
    handle(raw) {
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      const { type, payload } = message as { type?: unknown; payload?: unknown };

      switch (type) {
        case "rtf-bot-text": {
          const text = payloadText(payload);
          if (!text) return;
          if (!botTurnOpen) {
            botTurnOpen = true;
            botText = "";
          }
          botText = lastWords(appendChunk(botText, text));
          handlers.onSpeaker("interviewer");
          handlers.onCaption(botText);
          return;
        }
        case "rtf-bot-started-speaking":
          handlers.onSpeaker("interviewer");
          return;
        case "rtf-bot-stopped-speaking":
          closeBotTurn();
          handlers.onSpeaker("candidate");
          return;
        case "rtf-user-transcription":
          // The candidate started talking (possibly cutting the AI off).
          closeBotTurn();
          handlers.onSpeaker("candidate");
          return;
        default:
          return;
      }
    },
  };
}
