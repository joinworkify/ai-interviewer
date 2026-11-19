import { getCaller } from "@/lib/admin/server";
import { handleOverride, type OverrideStore } from "@/lib/evaluation/override-handler";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";

function realStore(): OverrideStore {
  const db = createAdminClient();
  return {
    async criterionNames(sessionId) {
      const { data, error } = await db
        .from("interview_evaluations")
        .select("status, criteria")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.status !== "completed" || !Array.isArray(data.criteria)) return null;
      return (data.criteria as { name?: unknown }[]).flatMap((c) => (typeof c.name === "string" ? [c.name] : []));
    },
    async set({ sessionId, criterion, score, reason, adminId }) {
      const { error } = await db.from("evaluation_overrides").upsert({
        session_id: sessionId,
        criterion,
        score,
        reason,
        updated_by: adminId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    async remove(sessionId, criterion) {
      const { error } = await db.from("evaluation_overrides").delete().eq("session_id", sessionId).eq("criterion", criterion);
      if (error) throw error;
    },
  };
}

async function runOverrideRoute(request: Request, params: Promise<{ id: string }>) {
  const { id } = await params;
  try {
    return await handleOverride(request, id, { getCaller, store: realStore() });
  } catch (err) {
    console.error("[overrides] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}

/** Admins only: set or change a criterion's score, with the reason. */
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runOverrideRoute(request, params);
}

/** Admins only: remove an override. */
export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runOverrideRoute(request, params);
}
