import { levelLabel, type LiveInterviewDetails } from "@/lib/gemini-live/interview-details";

/**
 * Builds the call context the browser passes to the Dograh widget. Dograh puts
 * these values into the agent prompt as {{initial_context.<name>}} and limits
 * them to 2000 characters per value.
 *
 * Everything here is data, never instructions. Role, level and tech stack were
 * already checked by validateLiveInterviewBody (no quotes, braces, angle
 * brackets or newlines). Stored questions come from an earlier LLM call, so
 * control characters, angle brackets, braces and pipes are removed, and each
 * question and the total are capped.
 *
 * The widget runs in the browser, so a user can edit this context. That only
 * changes their own interview. The webhook trusts nothing here except the
 * signed session token (see session-token.ts).
 */

export const MAX_CONTEXT_QUESTIONS = 10;
export const MAX_CONTEXT_QUESTION_CHARS = 300;
/** Dograh allows 2000 characters per value; leave room for JSON escaping. */
const MAX_QUESTIONS_VALUE_CHARS = 1900;

export function sanitizeQuestions(questions: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of questions.slice(0, MAX_CONTEXT_QUESTIONS)) {
    const q = raw
      .replace(/[\u0000-\u001f\u007f<>{}|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CONTEXT_QUESTION_CHARS);
    if (!q) continue;
    if (JSON.stringify([...kept, q]).length > MAX_QUESTIONS_VALUE_CHARS) break;
    kept.push(q);
  }
  return kept;
}

export function buildContextVariables(args: {
  details: LiveInterviewDetails;
  questions: readonly string[];
  sessionToken: string;
}): Record<string, string> {
  const questions = sanitizeQuestions(args.questions);
  return {
    session_token: args.sessionToken,
    role: args.details.role,
    level: levelLabel(args.details.level),
    techstack: args.details.techstack.join(", "),
    questions: JSON.stringify(questions),
    question_count: String(questions.length),
  };
}
