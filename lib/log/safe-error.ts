/**
 * Turns an unknown thrown value into a string that is safe to log.
 *
 * Error messages, causes and upstream response bodies can quote what we sent
 * or received: transcript text, tokens, API keys, row values (Postgres reports
 * the offending value in constraint and JSON errors). So this prints only the
 * error's class name plus, when present, a short `kind` or `code` slug (for
 * example LlmError "upstream", Postgres "23505", Node "ECONNRESET"). Never log
 * a raw error object or `err.message` for anything that touched user content.
 */
const SLUG = /^[A-Za-z0-9_.-]{1,40}$/;

function slug(value: unknown): string | null {
  return typeof value === "string" && SLUG.test(value) ? value : null;
}

export function describeError(err: unknown): string {
  if (err === null || typeof err !== "object") return typeof err;
  const record = err as Record<string, unknown>;
  const name = slug(record.name) ?? "Error";
  const parts = [slug(record.kind), slug(record.code)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? `${name}(${parts.join(",")})` : name;
}
