/**
 * Provider-neutral transcript model. Everything outside `adapters/` works with
 * these types only; nothing here knows which voice provider produced a turn.
 */

export type TranscriptRole = "interviewer" | "candidate";

/** What is stored in `interview_sessions.transcript`. */
export interface CanonicalTurn {
  role: TranscriptRole;
  text: string;
  /** ISO timestamp, when the provider reports one. */
  at?: string;
}

/**
 * Values allowed by the `interview_sessions_transcript_source_check`
 * constraint. Extending this list needs a migration that re-creates it.
 */
export const TRANSCRIPT_SOURCES = ["client_gemini_live", "dograh_webhook"] as const;
export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number];

export const ENDED_REASONS = [
  "user_ended",
  "interviewer_ended",
  "time_limit",
  "page_closed",
  "error",
] as const;
export type EndedReason = (typeof ENDED_REASONS)[number];

export interface TranscriptMetadata {
  source: TranscriptSource;
  durationSeconds: number;
  endedReason: EndedReason;
}

export interface ParsedTranscript {
  transcript: CanonicalTurn[];
  metadata: TranscriptMetadata;
}

export type AdapterResult =
  | { ok: true; value: ParsedTranscript }
  | { ok: false; errors: string[] };

/**
 * Turns one provider's payload into the canonical transcript plus metadata.
 *
 * Adding a provider: write an adapter that validates its own payload strictly
 * (reject unknown keys) and maps it to canonical turns, add its `source` name
 * to TRANSCRIPT_SOURCES and to the check constraint in a new migration, then
 * register it in `adapters/index.ts`. The handler, store, size limits and
 * feedback code stay unchanged.
 */
export interface TranscriptAdapter {
  readonly source: TranscriptSource;
  parse(payload: unknown): AdapterResult;
}
