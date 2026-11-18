import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import {
  ATTEMPT_DURATION_MINUTES,
  type AttemptRole,
  type AttemptStore,
  type RoleRequirement,
  type RoleStore,
} from "./attempts";

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

function parseRequirements(v: unknown): RoleRequirement[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (item): item is { title: string; text?: string } =>
        item != null && typeof item === "object" && typeof (item as { title?: unknown }).title === "string",
    )
    .map((item) => ({
      title: item.title,
      text: typeof item.text === "string" ? item.text : "",
    }));
}

/**
 * Looks up active roles by id from public.roles to construct interview questions.
 */
export function createSupabaseRoleStore(client: SupabaseClient<Database>): RoleStore {
  return {
    async getRole(id: string): Promise<AttemptRole | null> {
      const { data, error } = await client
        .from("roles")
        .select("id, title, requirements")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle();
      if (error) {
        console.error("[candidate-attempts] getRole failed:", describeError(error));
        throw new Error("getRole failed");
      }
      if (!data) return null;
      return {
        id: data.id,
        title: data.title,
        requirements: parseRequirements(data.requirements),
      };
    },
  };
}
