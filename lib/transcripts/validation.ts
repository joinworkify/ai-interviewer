import { TRANSCRIPT_SOURCES, type ParsedTranscript, type TranscriptAdapter, type TranscriptSource } from "./types";
import { checkLimits } from "./limits";

export type AdapterRegistry = Partial<Record<TranscriptSource, TranscriptAdapter>>;

export type TranscriptBodyResult =
  | { ok: true; data: ParsedTranscript }
  | { ok: false; errors: string[] };

/**
 * Strict body validation for PUT /api/sessions/:id/transcript:
 *   { source, payload }
 * `source` selects the adapter, which validates `payload`. The owner is never
 * read from the body. The adapter's canonical output is then held to the
 * shared size limits, so a new provider cannot bypass them.
 */
export function validateTranscriptBody(
  body: unknown,
  adapters: AdapterRegistry,
): TranscriptBodyResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Body must be a JSON object."] };
  }
  const record = body as Record<string, unknown>;
  const errors = Object.keys(record)
    .filter((k) => k !== "source" && k !== "payload")
    .map((k) => `Unknown field "${k.slice(0, 40)}".`);

  const source = record.source;
  const adapter =
    typeof source === "string" && (TRANSCRIPT_SOURCES as readonly string[]).includes(source)
      ? adapters[source as TranscriptSource]
      : undefined;
  if (!adapter) {
    errors.push(`source must be one of: ${Object.keys(adapters).join(", ")}.`);
    return { ok: false, errors };
  }
  if (!("payload" in record)) {
    errors.push("payload is required.");
    return { ok: false, errors };
  }

  const parsed = adapter.parse(record.payload);
  if (!parsed.ok) return { ok: false, errors: [...errors, ...parsed.errors] };

  errors.push(...checkLimits(parsed.value.transcript));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: parsed.value };
}
