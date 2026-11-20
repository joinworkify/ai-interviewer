import { readLlmConfig, type TokenUsage } from "@/lib/ai/client";
import { chatJson } from "@/lib/ai/json";
import { buildCleanTranscriptMessages, parseCleanedTranscript } from "@/lib/ai/prompts/clean-transcript";
import { checkQuota, readDailyCallLimit, type UsageStore } from "@/lib/ai/usage";
import { describeError } from "@/lib/log/safe-error";

import type { CanonicalTurn } from "./types";

/**
 * One LLM pass over a just-saved transcript that fixes obvious mishearings in
 * the candidate's captions. Each changed turn keeps its caption in `original`.
 * Returns null when nothing changed or the pass could not run (no LLM, daily
 * limit reached, bad output): the saved transcript then stays as it was.
 */

export const TRANSCRIPT_CLEANUP_FEATURE = "transcript-cleanup";

export interface TranscriptCleanupDeps {
  env: Record<string, string | undefined>;
  usage: UsageStore;
  fetch?: typeof fetch;
  now?: () => number;
}

export async function cleanTranscript(
  deps: TranscriptCleanupDeps,
  userId: string,
  transcript: CanonicalTurn[],
): Promise<CanonicalTurn[] | null> {
  if (!transcript.some((t) => t.role === "candidate")) return null;
  const llm = readLlmConfig(deps.env);
  const limit = readDailyCallLimit(deps.env);
  if (!llm.ok || !limit.ok) return null;

  try {
    const quota = await checkQuota(deps.usage, userId, limit.limit, (deps.now ?? Date.now)());
    if (!quota.allowed) return null;
  } catch (err) {
    console.error("[transcript-cleanup] quota check failed", describeError(err));
    return null;
  }

  const turns = transcript.map((t) => ({ role: t.role, text: t.text }));
  const spent: { usage: TokenUsage; model: string }[] = [];
  try {
    const { data: fixes } = await chatJson(
      llm.config,
      buildCleanTranscriptMessages(turns),
      (parsed) => parseCleanedTranscript(parsed, turns),
      {
        fetch: deps.fetch,
        retries: 1,
        repairAttempts: 1,
        logTag: TRANSCRIPT_CLEANUP_FEATURE,
        onUsage: (usage, model) => spent.push({ usage, model }),
      },
    );
    if (fixes.size === 0) return null;
    return transcript.map((t, i) => {
      const text = fixes.get(i);
      return text === undefined ? t : { ...t, text, original: t.text };
    });
  } catch (err) {
    console.error("[transcript-cleanup] failed", describeError(err));
    return null;
  } finally {
    for (const { usage, model } of spent) {
      try {
        await deps.usage.record({
          userId,
          feature: TRANSCRIPT_CLEANUP_FEATURE,
          model,
          promptTokens: usage.promptTokens ?? null,
          completionTokens: usage.completionTokens ?? null,
        });
      } catch (err) {
        console.error("[transcript-cleanup] usage record failed", describeError(err));
      }
    }
  }
}
