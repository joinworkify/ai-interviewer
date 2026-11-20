import { readLlmConfig, type TokenUsage } from "@/lib/ai/client";
import { chatJson } from "@/lib/ai/json";
import { buildCandidateQuestionsMessages } from "@/lib/ai/prompts/candidate-questions";
import { parseGeneratedQuestions } from "@/lib/ai/prompts/generate-questions";
import { checkQuota, readDailyCallLimit, type UsageStore } from "@/lib/ai/usage";
import { describeError } from "@/lib/log/safe-error";

/**
 * Interview questions written by the LLM for one candidate, from the role
 * they applied for and their chosen resume. Returns null whenever that is not
 * possible (no LLM configured, daily limit reached, model failure), so the
 * caller falls back to the fixed role questions and the interview still runs.
 */

export const CANDIDATE_QUESTIONS_FEATURE = "candidate-questions";

export interface TailoredRole {
  title: string;
  responsibilities: { title: string; text: string }[];
  requirements: { title: string; text: string }[];
}

export interface TailoredQuestionDeps {
  env: Record<string, string | undefined>;
  usage: UsageStore;
  /** Text of the candidate's chosen resume, or null when there is none to read. */
  loadResumeText: (userId: string) => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => number;
}

const asLines = (items: TailoredRole["responsibilities"]) => items.map((i) => `${i.title}: ${i.text}`);

export async function generateTailoredQuestions(
  deps: TailoredQuestionDeps,
  userId: string,
  role: TailoredRole,
  amount: number,
): Promise<string[] | null> {
  const llm = readLlmConfig(deps.env);
  const limit = readDailyCallLimit(deps.env);
  if (!llm.ok || !limit.ok) return null;

  try {
    const quota = await checkQuota(deps.usage, userId, limit.limit, (deps.now ?? Date.now)());
    if (!quota.allowed) return null;
  } catch (err) {
    console.error("[candidate-questions] quota check failed", describeError(err));
    return null;
  }

  let resumeText: string | null = null;
  try {
    resumeText = await deps.loadResumeText(userId);
  } catch (err) {
    // A resume we cannot read still gets role-based tailored questions.
    console.error("[candidate-questions] resume read failed", describeError(err));
  }

  const messages = buildCandidateQuestionsMessages({
    roleTitle: role.title,
    responsibilities: asLines(role.responsibilities),
    requirements: asLines(role.requirements),
    resumeText,
    amount,
  });

  const spent: { usage: TokenUsage; model: string }[] = [];
  try {
    const result = await chatJson(llm.config, messages, (parsed) => parseGeneratedQuestions(parsed, amount), {
      fetch: deps.fetch,
      retries: 1,
      repairAttempts: 1,
      logTag: CANDIDATE_QUESTIONS_FEATURE,
      onUsage: (usage, model) => spent.push({ usage, model }),
    });
    return result.data;
  } catch (err) {
    console.error("[candidate-questions] generation failed", describeError(err));
    return null;
  } finally {
    // Every billed call is counted against the daily limit, even rejected output.
    for (const { usage, model } of spent) {
      try {
        await deps.usage.record({
          userId,
          feature: CANDIDATE_QUESTIONS_FEATURE,
          model,
          promptTokens: usage.promptTokens ?? null,
          completionTokens: usage.completionTokens ?? null,
        });
      } catch (err) {
        console.error("[candidate-questions] usage record failed", describeError(err));
      }
    }
  }
}
