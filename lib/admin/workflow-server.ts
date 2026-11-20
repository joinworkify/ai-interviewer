import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";

import { isAdminClaims } from "./access";
import { getCaller, missingSupabaseEnv } from "./server";
import type { WorkflowDeps } from "./workflow";

/** An admin account's id and email, for the "assigned to" picker. */
export async function listAdmins(): Promise<{ id: string; email: string }[]> {
  const db = createAdminClient();
  const out: { id: string; email: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (isAdminClaims({ sub: u.id, app_metadata: u.app_metadata })) out.push({ id: u.id, email: u.email ?? u.id });
    }
    if (data.users.length < 200) break;
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

/** Real dependencies for the assign and notes routes. */
export async function runWorkflowRoute(run: (deps: WorkflowDeps) => Promise<Response>): Promise<Response> {
  const missing = missingSupabaseEnv();
  if (missing.length > 0) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "Supabase is not configured on the server.", missing });
  }
  try {
    const db = createAdminClient();
    const exists = async (sessionId: string) => {
      const { data, error } = await db.from("interview_sessions").select("id").eq("id", sessionId).maybeSingle();
      if (error) throw error;
      return data !== null;
    };
    return await run({
      getCaller,
      assign: {
        sessionExists: exists,
        async isAdminUser(userId) {
          const { data, error } = await db.auth.admin.getUserById(userId);
          return !error && !!data.user && isAdminClaims({ sub: data.user.id, app_metadata: data.user.app_metadata });
        },
        async setAssignee(sessionId, adminId) {
          // Only assigned_to is written, so an existing status is kept.
          const { error } = await db.from("interview_reviews").upsert({ session_id: sessionId, assigned_to: adminId });
          if (error) throw error;
        },
      },
      notes: {
        sessionExists: exists,
        async authorName(userId) {
          const { data } = await db.auth.admin.getUserById(userId);
          return data.user?.email ?? "Admin";
        },
        async add({ sessionId, authorId, authorName, body }) {
          const { data, error } = await db
            .from("reviewer_notes")
            .insert({ session_id: sessionId, author_id: authorId, author_name: authorName, body })
            .select("id, created_at")
            .single();
          if (error) throw error;
          return { id: data.id, createdAt: data.created_at };
        },
        async removeOwn(noteId, authorId) {
          const { data, error } = await db.from("reviewer_notes").delete().eq("id", noteId).eq("author_id", authorId).select("id");
          if (error) throw error;
          return (data ?? []).length > 0;
        },
      },
    });
  } catch (err) {
    console.error("[admin-workflow] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
