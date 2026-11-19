import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { IntegrityStore } from "./handler";

function fail(op: string, error: { code?: string } | null): never {
  console.error(`[integrity-store] ${op} failed`, error?.code ?? "");
  throw new Error(`${op} failed`);
}

/** Service-role client only: the table has no browser access. */
export function createSupabaseIntegrityStore(db: SupabaseClient<Database>): IntegrityStore {
  return {
    async ownsSession(userId, sessionId) {
      const { data, error } = await db
        .from("interview_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("ownsSession", error);
      return data !== null;
    },
    async count(sessionId) {
      const { count, error } = await db
        .from("interview_integrity_events")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      if (error) fail("count", error);
      return count ?? 0;
    },
    async insert(sessionId, events) {
      const { error } = await db.from("interview_integrity_events").insert(
        events.map((e) => ({
          session_id: sessionId,
          kind: e.kind,
          at_ms: e.atMs,
          duration_ms: e.durationMs ?? null,
        })),
      );
      if (error) fail("insert", error);
    },
  };
}
