/**
 * Normalizes `interview_sessions.transcript` (jsonb, written by the Vapi
 * webhook in a later branch) into plain turns for the evaluation prompt.
 *
 * Accepted shapes:
 *  - an array of `{ role, message | content | text }` (Vapi messages);
 *  - `{ messages: [...] }`;
 *  - a string such as "AI: ...\nUser: ..." (Vapi's `transcript` field).
 * System/tool turns are dropped. Text is stripped of control characters.
 */

export const MAX_TRANSCRIPT_CHARS = 60_000;

export type TurnRole = "interviewer" | "candidate" | "unknown";

export interface TranscriptTurn {
  role: TurnRole;
  text: string;
}

export type TranscriptResult =
  | { ok: true; turns: TranscriptTurn[] }
  | { ok: false; reason: "empty" | "too_large" };

const INTERVIEWER = new Set(["assistant", "bot", "ai", "interviewer"]);
const CANDIDATE = new Set(["user", "candidate"]);
const IGNORED = new Set(["system", "tool", "function", "tool_calls", "tool_call_result"]);

const LINE_ROLE_RE = /^(ai|assistant|bot|interviewer|user|candidate)\s*:\s*/i;

function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function roleOf(raw: string): TurnRole | "ignore" {
  const r = raw.trim().toLowerCase();
  if (INTERVIEWER.has(r)) return "interviewer";
  if (CANDIDATE.has(r)) return "candidate";
  if (IGNORED.has(r)) return "ignore";
  return "unknown";
}

function fromString(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE_ROLE_RE);
    if (m) {
      turns.push({ role: roleOf(m[1]) as TurnRole, text: line.slice(m[0].length) });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${line}`;
    } else {
      turns.push({ role: "unknown", text: line });
    }
  }
  return turns;
}

function fromMessages(items: unknown[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = [rec.message, rec.content, rec.text].find(
      (v): v is string => typeof v === "string",
    );
    if (text === undefined) continue;
    const role = typeof rec.role === "string" ? roleOf(rec.role) : "unknown";
    if (role === "ignore") continue;
    turns.push({ role, text });
  }
  return turns;
}

export function normalizeTranscript(value: unknown): TranscriptResult {
  let raw: TranscriptTurn[] = [];
  if (typeof value === "string") {
    raw = fromString(value);
  } else if (Array.isArray(value)) {
    raw = fromMessages(value);
  } else if (value && typeof value === "object") {
    const messages = (value as Record<string, unknown>).messages;
    if (Array.isArray(messages)) raw = fromMessages(messages);
  }

  const turns = raw
    .map((t) => ({ role: t.role, text: clean(t.text) }))
    .filter((t) => t.text.length > 0);

  // Something the candidate could have said is required to evaluate anything.
  if (!turns.some((t) => t.role !== "interviewer")) {
    return { ok: false, reason: "empty" };
  }
  const total = turns.reduce((n, t) => n + t.text.length, 0);
  if (total > MAX_TRANSCRIPT_CHARS) return { ok: false, reason: "too_large" };
  return { ok: true, turns };
}
