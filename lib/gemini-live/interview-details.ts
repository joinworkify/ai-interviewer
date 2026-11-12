/**
 * Interview details for the Gemini Live interviewer. Shared by the browser
 * form and the token route (pure, no SDK or Node imports).
 *
 * Only these fields are accepted; ownership/quotas come from the verified
 * Supabase session, never from the request body.
 */

/** Prototype hard cap for one Live session. */
export const MAX_SESSION_SECONDS = 300;
/** Name of the Gemini function tool the interviewer calls to finish. */
export const END_INTERVIEW_TOOL = "end_interview";

export const INTERVIEW_LEVELS = [
  { value: "intern", label: "Intern" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff / Principal" },
  { value: "lead", label: "Lead / Manager" },
] as const;

export type InterviewLevel = (typeof INTERVIEW_LEVELS)[number]["value"];

export interface LiveInterviewDetails {
  role: string;
  level: InterviewLevel;
  techstack: string[];
  /** Interview session the transcript will be saved to, when linked. */
  sessionId?: string;
}

export type LiveDetailsValidation =
  | { ok: true; data: LiveInterviewDetails }
  | { ok: false; errors: string[] };

export const MAX_ROLE_LENGTH = 80;
export const MAX_TECH_ITEMS = 8;
const MAX_TECH_ITEM_LENGTH = 40;
const MAX_TECHSTACK_RAW_LENGTH = 400;

const ALLOWED_KEYS = new Set(["role", "level", "techstack", "sessionId"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS: ReadonlyMap<string, InterviewLevel> = new Map(
  INTERVIEW_LEVELS.map((l) => [l.value, l.value]),
);

/**
 * Letters/numbers (any script), spaces and punctuation seen in job titles and
 * tech names (C++, C#, Node.js, UI/UX, R&D). No quotes, braces, angle
 * brackets or newlines: these values are embedded in the system instruction.
 */
const TEXT_RE = /^[\p{L}\p{N} +#.\-/&(),]+$/u;

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function levelLabel(level: InterviewLevel): string {
  return INTERVIEW_LEVELS.find((l) => l.value === level)?.label ?? level;
}

export function validateLiveInterviewBody(body: unknown): LiveDetailsValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }
  const record = body as Record<string, unknown>;
  const errors: string[] = [];

  const unknown = Object.keys(record).filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    errors.push(
      `Unexpected field(s): ${unknown
        .slice(0, 5)
        .map((k) => k.slice(0, 40))
        .join(", ")}.`,
    );
  }

  let role: string | undefined;
  if (typeof record.role !== "string") {
    errors.push("role must be a string.");
  } else {
    const r = normalize(record.role);
    if (!r) errors.push("role is required.");
    else if (r.length > MAX_ROLE_LENGTH)
      errors.push(`role must be at most ${MAX_ROLE_LENGTH} characters.`);
    // Test the raw value so control characters are not normalized away.
    else if (!TEXT_RE.test(record.role.trim()))
      errors.push("role contains unsupported characters.");
    else role = r;
  }

  const level =
    typeof record.level === "string"
      ? LEVELS.get(record.level.trim().toLowerCase())
      : undefined;
  if (!level) {
    errors.push(
      `level must be one of: ${INTERVIEW_LEVELS.map((l) => l.value).join(", ")}.`,
    );
  }

  let techstack: string[] | undefined;
  let items: unknown[] | undefined;
  if (typeof record.techstack === "string") {
    if (record.techstack.length > MAX_TECHSTACK_RAW_LENGTH) {
      errors.push("techstack is too long.");
    } else {
      items = record.techstack.split(",");
    }
  } else if (Array.isArray(record.techstack)) {
    items = record.techstack;
  } else {
    errors.push("techstack must be a comma-separated string or an array.");
  }
  if (items) {
    const seen = new Set<string>();
    const result: string[] = [];
    let bad = false;
    for (const item of items) {
      if (typeof item !== "string") {
        errors.push("techstack items must be strings.");
        bad = true;
        break;
      }
      const t = normalize(item);
      if (!t) continue;
      if (t.length > MAX_TECH_ITEM_LENGTH) {
        errors.push(
          `techstack items must be at most ${MAX_TECH_ITEM_LENGTH} characters.`,
        );
        bad = true;
        break;
      }
      if (!TEXT_RE.test(item.trim())) {
        errors.push("techstack contains unsupported characters.");
        bad = true;
        break;
      }
      if (!seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        result.push(t);
      }
    }
    if (!bad) {
      if (result.length === 0) {
        errors.push("techstack must list at least one technology.");
      } else if (result.length > MAX_TECH_ITEMS) {
        errors.push(`techstack must list at most ${MAX_TECH_ITEMS} items.`);
      } else {
        techstack = result;
      }
    }
  }

  let sessionId: string | undefined;
  if (record.sessionId !== undefined) {
    if (typeof record.sessionId === "string" && UUID_RE.test(record.sessionId)) {
      sessionId = record.sessionId;
    } else {
      errors.push("sessionId must be a UUID.");
    }
  }

  if (errors.length > 0 || !role || !level || !techstack) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    data: { role, level, techstack, ...(sessionId ? { sessionId } : {}) },
  };
}
