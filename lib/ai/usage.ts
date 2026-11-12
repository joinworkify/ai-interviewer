import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Per-user AI usage accounting and a rolling 24h call cap.
 *
 * The cap is a soft guard against runaway spend, not a billing system:
 * concurrent requests can each pass the check before any of them records, so
 * a burst may exceed the limit by the number of in-flight requests.
 */

export const DEFAULT_DAILY_CALL_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10_000;
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DailyLimitResult =
  | { ok: true; limit: number }
  | { ok: false; invalid: string };

export function readDailyCallLimit(
  env: Record<string, string | undefined>,
): DailyLimitResult {
  const raw = env.AI_DAILY_CALL_LIMIT?.trim();
  if (!raw) return { ok: true, limit: DEFAULT_DAILY_CALL_LIMIT };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_LIMIT || n > MAX_LIMIT) {
    return {
      ok: false,
      invalid: `AI_DAILY_CALL_LIMIT (integer ${MIN_LIMIT}-${MAX_LIMIT})`,
    };
  }
  return { ok: true, limit: n };
}

export interface UsageEntry {
  userId: string;
  feature: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface UsageStore {
  /** Number of recorded model calls by this user at or after `sinceIso`. */
  countSince(userId: string, sinceIso: string): Promise<number>;
  record(entry: UsageEntry): Promise<void>;
}

export interface QuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkQuota(
  store: UsageStore,
  userId: string,
  limit: number,
  nowMs: number,
): Promise<QuotaResult> {
  const since = new Date(nowMs - QUOTA_WINDOW_MS).toISOString();
  const used = await store.countSince(userId, since);
  return { allowed: used < limit, used, limit };
}

/** Must be given a service-role client: `ai_usage` writes are server-only. */
export function createSupabaseUsageStore(
  client: SupabaseClient<Database>,
): UsageStore {
  return {
    async countSince(userId, sinceIso) {
      const { count, error } = await client
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", sinceIso);
      if (error) throw Object.assign(new Error("ai_usage count failed"), { code: error.code });
      return count ?? 0;
    },
    async record(entry) {
      const { error } = await client.from("ai_usage").insert({
        user_id: entry.userId,
        feature: entry.feature,
        model: entry.model,
        prompt_tokens: entry.promptTokens,
        completion_tokens: entry.completionTokens,
      });
      if (error) throw Object.assign(new Error("ai_usage insert failed"), { code: error.code });
    },
  };
}
