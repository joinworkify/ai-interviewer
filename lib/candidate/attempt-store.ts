import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import { ATTEMPT_DURATION_MINUTES, type AttemptStore } from "./attempts";

/**
 * Must be given the service-role (admin) client: browsers cannot write
 * `interviews` or `interview_sessions`. RLS protects nothing here, so every
 * row is written with the user id the route verified from the JWT claims.
 */
export function createSupabaseAttemptStore(client: SupabaseClient<Database>): AttemptStore {
  return {
    async createAttempt(userId, questions) {
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
        const cleanup = await client
          .from("interviews")
          .delete()
          .eq("id", interview.data.id)
          .eq("user_id", userId);
        if (cleanup.error) {
          console.error("[candidate-attempts] cleanup failed:", describeError(cleanup.error));
        }
        throw new Error("createAttempt failed");
      }

      return { sessionId: session.data.id };
    },
  };
}
