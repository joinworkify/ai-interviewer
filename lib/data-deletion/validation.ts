import type { Validated } from "@/lib/sessions/validation";

/** The exact phrase the client must send to delete the account. */
export const DELETE_ACCOUNT_CONFIRMATION = "delete-my-data";

/** Strict: only `confirm`, and it must be the phrase. Unknown keys are rejected. */
export function validateDeleteAccountBody(body: unknown): Validated<{ confirm: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Body must be a JSON object."] };
  }
  const record = body as Record<string, unknown>;
  const errors = Object.keys(record)
    .filter((key) => key !== "confirm")
    .map((key) => `Unknown field "${key}".`);
  if (record.confirm !== DELETE_ACCOUNT_CONFIRMATION) {
    errors.push(`confirm must be "${DELETE_ACCOUNT_CONFIRMATION}".`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { confirm: DELETE_ACCOUNT_CONFIRMATION } };
}
