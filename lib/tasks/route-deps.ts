import "server-only";

import { after } from "next/server";

import { evaluateSession } from "@/lib/evaluation/store";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { TaskHandlerDeps, TaskRow } from "./handler";
import type { TaskKind } from "./tasks";

/** Real dependencies for the candidate task routes. Every query is scoped to the verified user's own session. */
export async function runTaskRoute(run: (deps: TaskHandlerDeps) => Promise<Response>): Promise<Response> {
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
        async tasksFor(userId, sessionId) {
          const session = await db.from("interview_sessions").select("id").eq("id", sessionId).eq("user_id", userId).maybeSingle();
          if (session.error) throw session.error;
          if (!session.data) return null;
          const consent = await db.from("candidate_consents").select("role_id").eq("session_id", sessionId).maybeSingle();
          if (consent.error) throw consent.error;
          if (!consent.data?.role_id) return [];
          const tasks = await db
            .from("role_tasks")
            .select("id, kind, title, prompt, minutes")
            .eq("role_id", consent.data.role_id)
            .order("position", { ascending: true });
          if (tasks.error) throw tasks.error;
          return (tasks.data ?? []).map((t): TaskRow => ({ id: t.id, kind: t.kind as TaskKind, title: t.title, prompt: t.prompt, minutes: t.minutes }));
        },
        async submissions(sessionId) {
          const { data, error } = await db.from("task_submissions").select("task_id, started_at, submitted_at").eq("session_id", sessionId);
          if (error) throw error;
          return (data ?? []).map((s) => ({ taskId: s.task_id, startedAt: new Date(s.started_at), submittedAt: s.submitted_at ? new Date(s.submitted_at) : null }));
        },
        async start(sessionId, taskId, now) {
          // Inserting is idempotent: an existing row keeps its original start time.
          await db.from("task_submissions").upsert({ session_id: sessionId, task_id: taskId, started_at: now.toISOString() }, { onConflict: "session_id,task_id", ignoreDuplicates: true });
          const { data, error } = await db.from("task_submissions").select("started_at").eq("session_id", sessionId).eq("task_id", taskId).single();
          if (error) throw error;
          return new Date(data.started_at);
        },
        async submit({ sessionId, taskId, answer, pasteCount, awayMs, now }) {
          const { data, error } = await db
            .from("task_submissions")
            .update({ answer, paste_count: pasteCount, away_ms: awayMs, submitted_at: now.toISOString() })
            .eq("session_id", sessionId)
            .eq("task_id", taskId)
            .is("submitted_at", null)
            .select("id");
          if (error) throw error;
          return (data ?? []).length > 0;
        },
      },
      // After the response: once every task is in, score again so the answers count.
      onSubmitted: ({ sessionId, allDone }) => {
        if (!allDone) return;
        after(async () => {
          await evaluateSession(sessionId, { force: true });
        });
      },
    });
  } catch (err) {
    console.error("[tasks] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
