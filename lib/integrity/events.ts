/**
 * Integrity signals: things the browser saw while the candidate was in the
 * interview. They are hints for a human reviewer, never an automatic verdict:
 * a notification, a phone call or a flaky connection all look like "away".
 *
 * Client-safe (no server imports).
 */

export const INTEGRITY_KINDS = ["tab_hidden", "window_blur", "offline", "paste", "fullscreen_exit"] as const;
export type IntegrityKind = (typeof INTEGRITY_KINDS)[number];

export interface IntegrityEvent {
  kind: IntegrityKind;
  /** Milliseconds since the interview started. */
  atMs: number;
  /** How long it lasted, when that applies. */
  durationMs?: number;
}

export const KIND_LABELS: Record<IntegrityKind, string> = {
  tab_hidden: "Switched to another tab or app",
  window_blur: "Clicked outside the interview window",
  offline: "Lost internet connection",
  paste: "Pasted text",
  fullscreen_exit: "Left full screen",
};

export const MAX_EVENTS_PER_REQUEST = 50;
export const MAX_EVENTS_PER_SESSION = 300;
/** Longer than any interview; guards against absurd client values. */
const MAX_MS = 6 * 60 * 60 * 1000;

export function isIntegrityKind(value: unknown): value is IntegrityKind {
  return typeof value === "string" && (INTEGRITY_KINDS as readonly string[]).includes(value);
}

const validMs = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_MS;

export function parseIntegrityEvents(
  value: unknown,
): { ok: true; events: IntegrityEvent[] } | { ok: false; message: string } {
  const list = (value as { events?: unknown } | null)?.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS_PER_REQUEST) {
    return { ok: false, message: `Send 1-${MAX_EVENTS_PER_REQUEST} events.` };
  }
  const events: IntegrityEvent[] = [];
  for (const item of list) {
    const e = item as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || !isIntegrityKind(e.kind) || !validMs(e.atMs)) {
      return { ok: false, message: "Invalid event." };
    }
    if (e.durationMs !== undefined && !validMs(e.durationMs)) return { ok: false, message: "Invalid event." };
    events.push({ kind: e.kind, atMs: e.atMs, ...(e.durationMs !== undefined ? { durationMs: e.durationMs as number } : {}) });
  }
  return { ok: true, events };
}

export type IntegrityLevel = "none" | "low" | "medium" | "high";

export interface IntegritySummary {
  counts: Record<IntegrityKind, number>;
  /** Total time the candidate was away from the tab (hidden), in ms. */
  awayMs: number;
  level: IntegrityLevel;
}

/**
 * A rough level for the reviewer's eye. Time away from the tab matters most
 * (looking something up); going offline is a connection problem, not
 * misconduct, so it never raises the level.
 */
export function summarizeIntegrity(events: readonly IntegrityEvent[]): IntegritySummary {
  const counts = Object.fromEntries(INTEGRITY_KINDS.map((k) => [k, 0])) as Record<IntegrityKind, number>;
  let awayMs = 0;
  for (const e of events) {
    counts[e.kind] += 1;
    if (e.kind === "tab_hidden") awayMs += e.durationMs ?? 0;
  }
  const away = counts.tab_hidden;
  let level: IntegrityLevel = "none";
  if (away + counts.paste + counts.fullscreen_exit + counts.window_blur > 0) level = "low";
  if (away >= 3 || awayMs >= 30_000 || counts.paste >= 1) level = "medium";
  if (away >= 6 || awayMs >= 120_000 || counts.paste >= 3) level = "high";
  return { counts, awayMs, level };
}
