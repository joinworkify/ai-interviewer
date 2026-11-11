import type { CanonicalTurn } from "./types";

/**
 * Size limits for a stored transcript. The total stays well under the 60,000
 * character cap the feedback prompt accepts, so every stored transcript can be
 * evaluated. The request cap also keeps a keepalive fetch under the browser's
 * 64 KiB body limit for ordinary (mostly ASCII) transcripts.
 */
export const MAX_TRANSCRIPT_ENTRIES = 200;
export const MAX_ENTRY_CHARS = 8_000;
export const MAX_TOTAL_CHARS = 24_000;
export const MAX_TRANSCRIPT_BODY_BYTES = 100 * 1024;

const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

/** Collapses control characters and runs of whitespace into single spaces. */
export function cleanTurnText(text: string): string {
  return text.replace(CONTROL_CHARS_RE, " ").replace(/\s+/g, " ").trim();
}

/** Server side: rejects what exceeds the limits instead of silently cutting it. */
export function checkLimits(turns: CanonicalTurn[]): string[] {
  const errors: string[] = [];
  if (turns.length > MAX_TRANSCRIPT_ENTRIES) {
    errors.push(`transcript must have at most ${MAX_TRANSCRIPT_ENTRIES} entries.`);
  }
  let total = 0;
  turns.forEach((t, i) => {
    total += t.text.length;
    if (t.text.length > MAX_ENTRY_CHARS) {
      errors.push(`transcript[${i}].text must be at most ${MAX_ENTRY_CHARS} characters.`);
    }
  });
  if (total > MAX_TOTAL_CHARS) {
    errors.push(`transcript must be at most ${MAX_TOTAL_CHARS} characters in total.`);
  }
  return errors;
}

/**
 * Client side: shrinks a long transcript to the limits so a rare very long
 * session still saves. Cuts overlong entries, then drops the oldest entries.
 */
export function fitToLimits<T extends { text: string }>(entries: T[]): T[] {
  const cut = entries.map((e) =>
    e.text.length > MAX_ENTRY_CHARS ? { ...e, text: e.text.slice(0, MAX_ENTRY_CHARS) } : e,
  );
  let start = Math.max(0, cut.length - MAX_TRANSCRIPT_ENTRIES);
  let total = 0;
  for (let i = start; i < cut.length; i++) total += cut[i].text.length;
  while (total > MAX_TOTAL_CHARS && start < cut.length) {
    total -= cut[start].text.length;
    start++;
  }
  return cut.slice(start);
}
