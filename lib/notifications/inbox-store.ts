import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { InboxWriter } from "./inbox";

const PG_UNIQUE_VIOLATION = "23505";

/** Service-role client: the table has no browser access. */
export function createSupabaseInboxWriter(db: SupabaseClient<Database>): InboxWriter {
  return {
    async add(item) {
      const { error } = await db.from("candidate_inbox").insert({
        user_id: item.userId,
        kind: item.kind,
        ...(item.sessionId ? { session_id: item.sessionId } : {}),
        title: item.title,
        body: item.body,
        link: item.link,
      });
      if (!error) return true;
      if (error.code === PG_UNIQUE_VIOLATION) return false;
      console.error("[inbox] add failed", error.code ?? "");
      throw new Error("inbox add failed");
    },
  };
}
