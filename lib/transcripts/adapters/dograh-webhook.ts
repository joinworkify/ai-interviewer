import { cleanTurnText } from "../limits";
import {
  type AdapterResult,
  type CanonicalTurn,
  type EndedReason,
  type TranscriptAdapter,
} from "../types";

/**
 * Dograh voice-agent calls. The webhook route downloads the call's transcript
 * file and hands this adapter the text plus two values from the webhook body:
 *
 *   { transcript: string, durationSeconds: number, disposition: string }
 *
 * Dograh writes one line per utterance (api/utils/transcript.py upstream):
 *
 *   [timestamp] user: what the candidate said
 *   [timestamp] assistant: what the interviewer said
 *
 * The timestamp part is optional. A line that does not start with a speaker
 * label continues the previous utterance. Consecutive lines from the same
 * speaker are merged, because Dograh can emit one line per sentence and the
 * stored transcript is capped by entry count.
 */
export interface DograhWebhookPayload {
  transcript: string;
  durationSeconds: number;
  disposition: string;
}

/** Calls are short; anything near an hour is bogus. */
const MAX_DURATION_SECONDS = 3600;
const MAX_DISPOSITION_LENGTH = 64;
const PAYLOAD_KEYS = ["transcript", "durationSeconds", "disposition"];

const LINE_RE = /^(?:\[([^\]\n]{1,80})\]\s+)?(user|assistant):[ \t]?(.*)$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Keeps a timestamp only when it is a real date; the label can be anything else. */
function toIso(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const start = label.split("->")[0].trim();
  const ms = Date.parse(start);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/**
 * Maps Dograh's call disposition onto the stored `ended_reason`. The value is
 * a free-form slug on Dograh's side, so unknown values fall back to
 * "interviewer_ended" rather than failing the whole transcript.
 */
export function endedReasonFromDisposition(disposition: string): EndedReason {
  const d = disposition.toLowerCase();
  if (/time.?limit|timeout|timed.?out|max.?duration/.test(d)) return "time_limit";
  if (/error|fail|exception/.test(d)) return "error";
  if (/user|caller|candidate|customer|hang.?up/.test(d) && !/agent|bot|assistant/.test(d)) {
    return "user_ended";
  }
  return "interviewer_ended";
}

export function parseDograhTranscriptText(text: string): CanonicalTurn[] | null {
  const turns: CanonicalTurn[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (m) {
      const role = m[2] === "user" ? "candidate" : "interviewer";
      const at = toIso(m[1]);
      const spoken = cleanTurnText(m[3]);
      const last = turns[turns.length - 1];
      if (last && last.role === role) {
        if (spoken) last.text = `${last.text} ${spoken}`;
      } else if (spoken) {
        turns.push({ role, text: spoken, ...(at ? { at } : {}) });
      }
      continue;
    }
    const last = turns[turns.length - 1];
    if (!last) return null; // the file does not start like a Dograh transcript
    const more = cleanTurnText(line);
    if (more) last.text = `${last.text} ${more}`;
  }
  return turns;
}

export const dograhWebhookAdapter: TranscriptAdapter = {
  source: "dograh_webhook",

  parse(payload: unknown): AdapterResult {
    if (!isRecord(payload)) return { ok: false, errors: ["payload must be a JSON object."] };
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

    const disposition = payload.disposition;
    if (
      typeof disposition !== "string" ||
      disposition.length > MAX_DISPOSITION_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(disposition)
    ) {
      errors.push(`payload.disposition must be text of at most ${MAX_DISPOSITION_LENGTH} characters.`);
    }

    let turns: CanonicalTurn[] = [];
    if (typeof payload.transcript !== "string") {
      errors.push("payload.transcript must be a string.");
    } else {
      const parsed = parseDograhTranscriptText(payload.transcript);
      if (parsed === null) errors.push("payload.transcript is not in the expected Dograh format.");
      else turns = parsed;
    }

    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        transcript: turns,
        metadata: {
          source: "dograh_webhook",
          durationSeconds: duration as number,
          endedReason: endedReasonFromDisposition(disposition as string),
        },
      },
    };
  },
};
