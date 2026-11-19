import { readLlmConfig, type TokenUsage } from "@/lib/ai/client";
import { chatJson } from "@/lib/ai/json";
import { checkQuota, readDailyCallLimit, type UsageStore } from "@/lib/ai/usage";
import { describeError } from "@/lib/log/safe-error";
import { normalizeTranscript, type TranscriptTurn } from "@/lib/sessions/transcript";

import {
  buildEvaluationMessages,
  type TaskAnswer,
  candidateWordCount,
  MIN_CANDIDATE_WORDS,
  parseEvaluation,
  type RubricEvaluation,
} from "./evaluate";
import { rubricOrDefault, type RubricCriterion } from "./rubric";

/**
 * Scores one stored interview against its role's rubric and saves the result.
 * Runs server-side after the transcript is stored (and again when an admin
 * asks). It never throws: every outcome is a short code, and a failed run is
 * saved as a 'failed' row so the admin page can say why there is no score.
 * Transcript text and provider messages are never logged.
 */

export const EVALUATION_FEATURE = "rubric-evaluation";

export type EvaluationFailure =
  | "session_not_found"
  | "no_transcript"
  | "too_short"
  | "llm_not_configured"
  | "quota"
  | "llm_failed";

export type EvaluationOutcome =
  | { kind: "evaluated"; evaluation: RubricEvaluation }
  | { kind: "skipped"; reason: "already_evaluated" }
  | { kind: "failed"; code: EvaluationFailure };

export interface EvaluationInput {
  sessionId: string;
  userId: string;
  transcript: unknown;
  roleTitle: string | null;
  rubric: unknown;
  /** Submitted work-sample answers, if the role has tasks. */
  tasks?: TaskAnswer[];
}

export interface EvaluationStore {
  /** The session, its transcript and its role's rubric; null when no such session. */
  load(sessionId: string): Promise<EvaluationInput | null>;
  hasCompleted(sessionId: string): Promise<boolean>;
  saveCompleted(sessionId: string, evaluation: RubricEvaluation, model: string): Promise<void>;
  saveFailed(sessionId: string, code: EvaluationFailure): Promise<void>;
}

export interface EvaluationDeps {
  env: Record<string, string | undefined>;
  store: EvaluationStore;
  usage: UsageStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export async function runRubricEvaluation(
  deps: EvaluationDeps,
  sessionId: string,
  options: { /** An admin asked: re-score and skip the daily quota. */ force?: boolean } = {},
): Promise<EvaluationOutcome> {
  const { store } = deps;
  const force = options.force === true;

  const input = await store.load(sessionId);
  if (!input) return { kind: "failed", code: "session_not_found" };
  if (!force && (await store.hasCompleted(sessionId))) {
    return { kind: "skipped", reason: "already_evaluated" };
  }

  const fail = async (code: EvaluationFailure): Promise<EvaluationOutcome> => {
    try {
      await store.saveFailed(sessionId, code);
    } catch (err) {
      console.error("[evaluation] could not save failure", describeError(err));
    }
    return { kind: "failed", code };
  };

  const normalized = input.transcript == null ? null : normalizeTranscript(input.transcript);
  if (!normalized || !normalized.ok) return fail("no_transcript");
  const turns: TranscriptTurn[] = normalized.turns;
  if (candidateWordCount(turns) < MIN_CANDIDATE_WORDS) return fail("too_short");

  const llm = readLlmConfig(deps.env);
  if (!llm.ok) return fail("llm_not_configured");

  if (!force) {
    const limit = readDailyCallLimit(deps.env);
    if (limit.ok) {
      try {
        const quota = await checkQuota(deps.usage, input.userId, limit.limit, (deps.now ?? Date.now)());
        if (!quota.allowed) return fail("quota");
      } catch (err) {
        console.error("[evaluation] quota check failed", describeError(err));
        return fail("llm_failed");
      }
    }
  }

  const rubric: RubricCriterion[] = rubricOrDefault(input.rubric);
  const spent: { usage: TokenUsage; model: string }[] = [];
  try {
    const { data, model } = await chatJson(
      llm.config,
      buildEvaluationMessages({ roleTitle: input.roleTitle ?? "the role", rubric, turns, tasks: input.tasks }),
      (parsed) => parseEvaluation(parsed, rubric),
      {
        fetch: deps.fetch,
        retries: 1,
        repairAttempts: 1,
        logTag: EVALUATION_FEATURE,
        onUsage: (usage, m) => spent.push({ usage, model: m }),
      },
    );
    await store.saveCompleted(sessionId, data, model);
    return { kind: "evaluated", evaluation: data };
  } catch (err) {
    console.error("[evaluation] failed", describeError(err));
    return fail("llm_failed");
  } finally {
    for (const { usage, model } of spent) {
      try {
        await deps.usage.record({
          userId: input.userId,
          feature: EVALUATION_FEATURE,
          model,
          promptTokens: usage.promptTokens ?? null,
          completionTokens: usage.completionTokens ?? null,
        });
      } catch (err) {
        console.error("[evaluation] usage record failed", describeError(err));
      }
    }
  }
}
