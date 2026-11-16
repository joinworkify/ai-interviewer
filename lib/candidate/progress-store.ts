import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import type { ProgressStore } from "./progress";

/**
 * Takes the service-role client like the other candidate stores, so every query
 * is pinned to the user id the route verified from the JWT claims.
 */
export function createSupabaseProgressStore(client: SupabaseClient<Database>): ProgressStore {
  return {
    async findOpenAttempt(userId, roleId, cutoff) {
      // Each attempt has exactly one consent row, which carries the role.
      const { data, error } = await client
        .from("candidate_consents")
        .select("session_id, interview_sessions!inner(status, transcript, started_at)")
        .eq("user_id", userId)
        .eq("role_id", roleId)
        .order("accepted_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("[candidate-progress] find attempt failed:", describeError(error));
        throw new Error("findOpenAttempt failed");
      }
      if (!data) return null;
      const session = Array.isArray(data.interview_sessions) ? data.interview_sessions[0] : data.interview_sessions;
      if (!session) return null;
      const open =
        session.status === "in_progress" &&
        session.transcript == null &&
        new Date(session.started_at).getTime() >= cutoff.getTime();
      return open ? { id: data.session_id } : null;
    },

    async hasUploadedResume(userId) {
      const { count, error } = await client
        .from("candidate_resumes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("status", "uploaded");
      if (error || count == null) {
        console.error("[candidate-progress] resume check failed:", describeError(error));
        throw new Error("hasUploadedResume failed");
      }
      return count > 0;
    },
  };
}
