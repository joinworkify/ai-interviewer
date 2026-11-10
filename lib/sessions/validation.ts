import { MAX_ANSWER_LENGTH } from "@/lib/ai/prompts/evaluate-answers";
import { MAX_QUESTIONS } from "@/lib/interviews/validation";

/**
 * Strict validation for the session endpoints' request bodies. Unknown keys are
 * rejected: the owner always comes from the verified session, never the body.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type Validated<T> = { ok: true; data: T } | { ok: false; errors: string[] };

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function unknownKeys(record: Record<string, unknown>, allowed: string[]) {
  return Object.keys(record)
    .filter((k) => !allowed.includes(k))
    .map((k) => `Unknown field "${k}".`);
}

export function validateStartSessionBody(
  body: unknown,
): Validated<{ interviewId: string }> {
  const record = asRecord(body);
  if (!record) return { ok: false, errors: ["Body must be a JSON object."] };
  const errors = unknownKeys(record, ["interviewId"]);
  if (!isUuid(record.interviewId)) errors.push("interviewId must be a UUID.");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { interviewId: record.interviewId as string } };
}

export interface SubmittedAnswer {
  questionIndex: number;
  answer: string;
}

/**
 * `required: false` lets `answers` be absent (the server then uses the stored
 * transcript); when present it is validated exactly the same way. Absent
 * answers come back as an empty list.
 */
export function validateFeedbackBody(
  body: unknown,
  options: { required?: boolean } = {},
): Validated<{ answers: SubmittedAnswer[] }> {
  const record = asRecord(body);
  if (!record) return { ok: false, errors: ["Body must be a JSON object."] };
  const errors = unknownKeys(record, ["answers"]);

  if (options.required === false && !("answers" in record)) {
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, data: { answers: [] } };
  }

  const raw = record.answers;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUESTIONS) {
    errors.push(`answers must be an array of 1-${MAX_QUESTIONS} items.`);
    return { ok: false, errors };
  }

  const answers: SubmittedAnswer[] = [];
  const seen = new Set<number>();
  raw.forEach((item, i) => {
    const entry = asRecord(item);
    if (!entry) {
      errors.push(`answers[${i}] must be an object.`);
      return;
    }
    for (const e of unknownKeys(entry, ["questionIndex", "answer"])) {
      errors.push(`answers[${i}]: ${e}`);
    }
    const idx = entry.questionIndex;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
      errors.push(`answers[${i}].questionIndex must be a non-negative integer.`);
    } else if (seen.has(idx)) {
      errors.push(`answers[${i}].questionIndex ${idx} is duplicated.`);
    } else {
      seen.add(idx);
    }
    const text =
      typeof entry.answer === "string"
        ? entry.answer.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
        : "";
    if (typeof entry.answer !== "string" || text.length === 0) {
      errors.push(`answers[${i}].answer must be a non-empty string.`);
    } else if (text.length > MAX_ANSWER_LENGTH) {
      errors.push(`answers[${i}].answer must be at most ${MAX_ANSWER_LENGTH} characters.`);
    } else if (typeof idx === "number") {
      answers.push({ questionIndex: idx, answer: text });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { answers } };
}
