import { cleanTurnText } from "../limits";
import {
  ENDED_REASONS,
  type AdapterResult,
  type CanonicalTurn,
  type EndedReason,
  type TranscriptAdapter,
} from "../types";

/**
 * Payload the Gemini Live browser client sends: the entries it accumulated
 * from the Live API's input/output transcription, plus how the session ended.
 * The speaker values mirror the browser transcript on purpose; they are
 * redeclared here so this module does not depend on the browser code.
 *
 *   { entries: [{ speaker, text, interrupted? }], durationSeconds, endedReason }
 */
export interface GeminiLiveClientPayload {
  entries: { speaker: "candidate" | "interviewer"; text: string; interrupted?: boolean }[];
  durationSeconds: number;
  endedReason: EndedReason;
}

/** The Live session is capped at 5 minutes; anything near an hour is bogus. */
const MAX_DURATION_SECONDS = 3600;

const PAYLOAD_KEYS = ["entries", "durationSeconds", "endedReason"];
const ENTRY_KEYS = ["speaker", "text", "interrupted"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export const geminiLiveClientAdapter: TranscriptAdapter = {
  source: "client_gemini_live",

  parse(payload: unknown): AdapterResult {
    if (!isRecord(payload)) {
      return { ok: false, errors: ["payload must be a JSON object."] };
    }
    const errors = Object.keys(payload)
      .filter((k) => !PAYLOAD_KEYS.includes(k))
      .map((k) => `Unknown field "payload.${k.slice(0, 40)}".`);

    const duration = payload.durationSeconds;
    if (
      typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration < 0 ||
      duration > MAX_DURATION_SECONDS
    ) {
      errors.push(`payload.durationSeconds must be an integer from 0 to ${MAX_DURATION_SECONDS}.`);
    }

    const reason = payload.endedReason;
    if (typeof reason !== "string" || !(ENDED_REASONS as readonly string[]).includes(reason)) {
      errors.push(`payload.endedReason must be one of: ${ENDED_REASONS.join(", ")}.`);
    }

    const turns: CanonicalTurn[] = [];
    if (!Array.isArray(payload.entries)) {
      errors.push("payload.entries must be an array.");
    } else {
      payload.entries.forEach((item, i) => {
        if (!isRecord(item)) {
          errors.push(`payload.entries[${i}] must be an object.`);
          return;
        }
        for (const k of Object.keys(item)) {
          if (!ENTRY_KEYS.includes(k)) {
            errors.push(`payload.entries[${i}]: unknown field "${k.slice(0, 40)}".`);
          }
        }
        if (item.speaker !== "candidate" && item.speaker !== "interviewer") {
          errors.push(`payload.entries[${i}].speaker must be "candidate" or "interviewer".`);
          return;
        }
        if (typeof item.text !== "string") {
          errors.push(`payload.entries[${i}].text must be a string.`);
          return;
        }
        if (item.interrupted !== undefined && typeof item.interrupted !== "boolean") {
          errors.push(`payload.entries[${i}].interrupted must be a boolean.`);
        }
        const text = cleanTurnText(item.text);
        if (text.length > 0) turns.push({ role: item.speaker, text });
      });
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        transcript: turns,
        metadata: {
          source: "client_gemini_live",
          durationSeconds: duration as number,
          endedReason: reason as EndedReason,
        },
      },
    };
  },
};
