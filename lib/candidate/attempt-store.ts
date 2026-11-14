import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import { ATTEMPT_DURATION_MINUTES, type AttemptStore } from "./attempts";

/**
 * Must be given the service-role (admin) client: browsers cannot write
 * `interviews`, `interview_sessions` or `candidate_consents`. RLS protects
 * nothing here, so every row is written with the user id the route verified
 * from the JWT claims.
 *
 * The three inserts are not one transaction, so a failure after the first
 * deletes the interview; the session and consent rows go with it (cascade).
 * An attempt therefore never exists without its consent record.
 */
export function createSupabaseAttemptStore(client: SupabaseClient<Database>): AttemptStore {
  return {
    async abandonStaleAttempts(userId, cutoff) {
      const { error } = await client
        .from("interview_sessions")
        .update({ status: "abandoned", ended_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("status", "in_progress")
        .is("transcript", null)
        .lt("started_at", cutoff.toISOString());
      if (error) {
        console.error("[candidate-attempts] abandon stale failed:", describeError(error));
        throw new Error("abandonStaleAttempts failed");
      }
    },

    async countAttempts(userId, roleId) {
      // Each attempt has exactly one consent row, which carries the role.
      const { count, error } = await client
        .from("candidate_consents")
        .select("session_id, interview_sessions!inner(status)", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role_id", roleId)
        .neq("interview_sessions.status", "abandoned");
      if (error || count == null) {
        console.error("[candidate-attempts] count attempts failed:", describeError(error));
        throw new Error("countAttempts failed");
      }
      return count;
    },

    async createAttempt(userId, questions, consent) {
      const removeInterview = async (interviewId: string) => {
        const cleanup = await client
          .from("interviews")
          .delete()
          .eq("id", interviewId)
          .eq("user_id", userId);
        if (cleanup.error) {
          console.error("[candidate-attempts] cleanup failed:", describeError(cleanup.error));
        }
      };

      const interview = await client
        .from("interviews")
        .insert({
          user_id: userId,
          questions,
          duration_minutes: ATTEMPT_DURATION_MINUTES,
        })
        .select("id")
        .single();
      if (interview.error || !interview.data) {
        console.error("[candidate-attempts] insert interview failed:", describeError(interview.error));
        throw new Error("createAttempt failed");
      }

      const session = await client
        .from("interview_sessions")
        .insert({ user_id: userId, interview_id: interview.data.id })
        .select("id")
        .single();
      if (session.error || !session.data) {
        console.error("[candidate-attempts] insert session failed:", describeError(session.error));
        // Do not leave an interview with no session behind.
        await removeInterview(interview.data.id);
        throw new Error("createAttempt failed");
      }

      const recorded = await client.from("candidate_consents").insert({
        user_id: userId,
        session_id: session.data.id,
        role_id: consent.roleId,
        consent_version: consent.version,
      });
      if (recorded.error) {
        console.error("[candidate-attempts] insert consent failed:", describeError(recorded.error));
        // No consent record, no attempt (the session goes with its interview).
        await removeInterview(interview.data.id);
        throw new Error("createAttempt failed");
      }

      return { sessionId: session.data.id };
    },
  };
}
