/**
 * Strict validation for the body that the Vapi API Request tool sends to
 * `POST /api/vapi/generate-interview`.
 *
 * Expected shape (LLM-filled fields + one static field):
 * {
 *   role: string, level: string, type: "technical" | "behavioral" | "mixed",
 *   techstack: string | string[], amount: integer 1..MAX,
 *   capability: string   // static field, filled from {{generationToken}}
 * }
 *
 * Any other key (notably `userid` / `userId`) is rejected: the owner of the
 * interview comes only from the verified capability token.
 */

export const INTERVIEW_TYPES = ["technical", "behavioral", "mixed"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

export const MIN_QUESTIONS = 1;
export const MAX_QUESTIONS = 10;
export const MAX_TECHSTACK_ITEMS = 12;
const MAX_ROLE_LENGTH = 80;
const MAX_LEVEL_LENGTH = 40;
const MAX_TECH_ITEM_LENGTH = 40;
const MAX_TECHSTACK_RAW_LENGTH = 600;

const ALLOWED_KEYS = new Set([
  "role",
  "level",
  "type",
  "techstack",
  "amount",
  "capability",
]);

/**
 * Letters/numbers (any script), spaces and a few punctuation characters that
 * appear in real job titles and tech names (C++, C#, Node.js, UI/UX, R&D).
 * Rejects braces, quotes, angle brackets, newlines, etc. which have no
 * business in these fields and reduce prompt-injection surface.
 */
const TEXT_RE = /^[\p{L}\p{N} +#.\-/&(),']+$/u;

export interface GenerateInterviewInput {
  role: string;
  level: string;
  type: InterviewType;
  techstack: string[];
  amount: number;
}

export type ValidationResult =
  | { ok: true; data: GenerateInterviewInput; capability: unknown }
  | { ok: false; errors: string[] };

// A Map (not an object literal) so that keys such as "constructor",
// "__proto__" or "toString" cannot resolve to inherited Object.prototype
// members and slip past validation.
const TYPE_ALIASES: ReadonlyMap<string, InterviewType> = new Map([
  ["technical", "technical"],
  ["behavioral", "behavioral"],
  ["behavioural", "behavioral"],
  ["mixed", "mixed"],
]);

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateText(
  field: string,
  value: unknown,
  maxLength: number,
  errors: string[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return undefined;
  }
  const normalized = normalizeSpaces(value);
  if (normalized.length === 0) {
    errors.push(`${field} is required.`);
    return undefined;
  }
  if (normalized.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters.`);
    return undefined;
  }
  if (!TEXT_RE.test(normalized)) {
    errors.push(`${field} contains unsupported characters.`);
    return undefined;
  }
  return normalized;
}

function validateAmount(value: unknown, errors: string[]): number | undefined {
  let n: number | undefined;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^\s*\d{1,3}\s*$/.test(value)) {
    // LLM tool arguments sometimes arrive as numeric strings.
    n = Number(value.trim());
  }
  if (n === undefined || !Number.isInteger(n)) {
    errors.push("amount must be an integer.");
    return undefined;
  }
  if (n < MIN_QUESTIONS || n > MAX_QUESTIONS) {
    errors.push(
      `amount must be between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}.`,
    );
    return undefined;
  }
  return n;
}

function validateTechstack(
  value: unknown,
  errors: string[],
): string[] | undefined {
  let items: unknown[];
  if (typeof value === "string") {
    if (value.length > MAX_TECHSTACK_RAW_LENGTH) {
      errors.push("techstack is too long.");
      return undefined;
    }
    items = value.split(",");
  } else if (Array.isArray(value)) {
    items = value;
  } else {
    errors.push("techstack must be a comma-separated string or an array.");
    return undefined;
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") {
      errors.push("techstack items must be strings.");
      return undefined;
    }
    const normalized = normalizeSpaces(item);
    if (normalized.length === 0) continue;
    if (normalized.length > MAX_TECH_ITEM_LENGTH) {
      errors.push(
        `techstack items must be at most ${MAX_TECH_ITEM_LENGTH} characters.`,
      );
      return undefined;
    }
    if (!TEXT_RE.test(normalized)) {
      errors.push("techstack contains unsupported characters.");
      return undefined;
    }
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  if (result.length === 0) {
    errors.push("techstack must list at least one technology.");
    return undefined;
  }
  if (result.length > MAX_TECHSTACK_ITEMS) {
    errors.push(`techstack must list at most ${MAX_TECHSTACK_ITEMS} items.`);
    return undefined;
  }
  return result;
}

export function validateGenerateInterviewBody(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }
  const record = body as Record<string, unknown>;
  const errors: string[] = [];

  const unknownKeys = Object.keys(record).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknownKeys.length > 0) {
    errors.push(
      `Unexpected field(s): ${unknownKeys
        .slice(0, 5)
        .map((k) => k.slice(0, 40))
        .join(", ")}.`,
    );
  }

  const role = validateText("role", record.role, MAX_ROLE_LENGTH, errors);
  const level = validateText("level", record.level, MAX_LEVEL_LENGTH, errors);

  let type: InterviewType | undefined;
  if (typeof record.type !== "string") {
    errors.push("type must be a string.");
  } else {
    type = TYPE_ALIASES.get(record.type.trim().toLowerCase());
    if (!type) {
      errors.push(`type must be one of: ${INTERVIEW_TYPES.join(", ")}.`);
    }
  }

  const techstack = validateTechstack(record.techstack, errors);
  const amount = validateAmount(record.amount, errors);

  if (
    errors.length > 0 ||
    role === undefined ||
    level === undefined ||
    type === undefined ||
    techstack === undefined ||
    amount === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: { role, level, type, techstack, amount },
    capability: record.capability,
  };
}
