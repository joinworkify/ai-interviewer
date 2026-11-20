/**
 * Scoring rubric for a role: the criteria its interviews are scored against.
 *
 * Client-safe (no server imports): the admin role editor and the server both
 * use it. A role with no rubric of its own falls back to DEFAULT_RUBRIC, so
 * every interview can be scored.
 */

export interface RubricCriterion {
  name: string;
  /** What good looks like; given to the scoring model. */
  description: string;
  /** 1 (minor) to 5 (critical): the criterion's share of the overall score. */
  weight: number;
}

export const MAX_CRITERIA = 8;
export const MAX_CRITERION_NAME = 60;
export const MAX_CRITERION_DESCRIPTION = 300;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;

export const DEFAULT_RUBRIC: readonly RubricCriterion[] = [
  {
    name: "Role knowledge",
    description: "Understands the core skills, tools and concepts the role needs and explains them correctly.",
    weight: 4,
  },
  {
    name: "Problem solving",
    description: "Breaks problems down, reasons step by step and reaches sensible answers.",
    weight: 3,
  },
  {
    name: "Relevant experience",
    description: "Gives concrete examples from past work that match the role.",
    weight: 3,
  },
  {
    name: "Communication",
    description: "Answers clearly and directly, with a logical structure and the right level of detail.",
    weight: 2,
  },
];

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export type RubricResult =
  | { ok: true; rubric: RubricCriterion[] }
  | { ok: false; message: string };

/**
 * Validates a rubric from untrusted input (admin form or stored jsonb).
 * An empty array is valid and means "use the default rubric". Names must be
 * unique, ignoring case, so scores can be matched back to criteria by name.
 */
export function parseRubric(value: unknown): RubricResult {
  if (!Array.isArray(value)) return { ok: false, message: "Rubric must be a list." };
  if (value.length > MAX_CRITERIA) {
    return { ok: false, message: `A rubric can have at most ${MAX_CRITERIA} criteria.` };
  }
  const rubric: RubricCriterion[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, message: "Each criterion must be an object." };
    }
    const c = item as Record<string, unknown>;
    if (typeof c.name !== "string" || typeof c.description !== "string") {
      return { ok: false, message: "Each criterion needs a name and a description." };
    }
    const name = cleanLine(c.name);
    const description = cleanLine(c.description);
    if (!name || name.length > MAX_CRITERION_NAME) {
      return { ok: false, message: `Criterion names must be 1-${MAX_CRITERION_NAME} characters.` };
    }
    if (!description || description.length > MAX_CRITERION_DESCRIPTION) {
      return {
        ok: false,
        message: `Criterion descriptions must be 1-${MAX_CRITERION_DESCRIPTION} characters.`,
      };
    }
    const weight = c.weight;
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
      return { ok: false, message: `Weights must be whole numbers from ${MIN_WEIGHT} to ${MAX_WEIGHT}.` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, message: `Criterion "${name}" is listed twice.` };
    seen.add(key);
    rubric.push({ name, description, weight });
  }
  return { ok: true, rubric };
}

/** The role's own rubric when it has a valid one, otherwise the default. */
export function rubricOrDefault(stored: unknown): RubricCriterion[] {
  const parsed = parseRubric(stored);
  return parsed.ok && parsed.rubric.length > 0 ? parsed.rubric : [...DEFAULT_RUBRIC];
}
