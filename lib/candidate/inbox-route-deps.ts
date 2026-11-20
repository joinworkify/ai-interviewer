import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { InboxHandlerDeps } from "./inbox";

/** Real dependencies for /api/candidate/notifications. Always filtered by the verified user id. */
export async function runInboxRoute(run: (deps: InboxHandlerDeps) => Promise<Response>): Promise<Response> {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "Supabase is not configured on the server.", missing });
  }
  try {
    const supabase = await createClient();
    const db = createAdminClient();
    return await run({
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: {
        async list(userId, limit) {
          const { data, error } = await db
            .from("candidate_inbox")
            .select("id, kind, title, body, link, read_at, created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(limit);
          if (error) throw error;
          return (data ?? []).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: n.read_at !== null, createdAt: n.created_at }));
        },
        async unreadCount(userId) {
          const { count, error } = await db
            .from("candidate_inbox")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .is("read_at", null);
          if (error) throw error;
          return count ?? 0;
        },
        async markAllRead(userId) {
          const { error } = await db
            .from("candidate_inbox")
            .update({ read_at: new Date().toISOString() })
            .eq("user_id", userId)
            .is("read_at", null);
          if (error) throw error;
        },
      },
    });
  } catch (err) {
    console.error("[candidate-inbox] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
