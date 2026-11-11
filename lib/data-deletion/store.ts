import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Deletion of a user's AI interview data. Must be given the service-role
 * client: browsers cannot write these tables, and deleting an auth user needs
 * the admin API. Every query is filtered by the verified user id explicitly,
 * because the service role bypasses Row Level Security.
 *
 * `vapi_events` has no user column and no foreign key, so cascades never reach
 * it. Each operation calls `purge_vapi_events` BEFORE removing the session it
 * is keyed through (`vapi_call_id`), and aborts if the purge fails.
 */

export class DeletionStoreError extends Error {}

export interface DeletionStore {
  /**
   * Clears the transcript and recording URL of one session, keeping the
   * session and its feedback. False when the session is not the user's.
   */
  deleteTranscript(userId: string, sessionId: string): Promise<boolean>;
  /** Deletes one session; its feedback cascades. False when not the user's. */
  deleteSession(userId: string, sessionId: string): Promise<boolean>;
  /** Deletes the auth user; everything else cascades through profiles. */
  deleteAccount(userId: string): Promise<void>;
}

function fail(op: string, error?: { code?: string } | null): never {
  // Op name and Postgres code only: error messages can carry row values.
  console.error(`[deletion] ${op} failed`, error?.code ?? "");
  throw new DeletionStoreError(`${op} failed`);
}

export function createSupabaseDeletionStore(
  client: SupabaseClient<Database>,
): DeletionStore {
  async function ownsSession(userId: string, sessionId: string, op: string) {
    const { data, error } = await client
      .from("interview_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail(op, error);
    return data !== null;
  }

  async function purge(op: string, userId: string, sessionId: string | null) {
    const { error } = await client.rpc("purge_vapi_events", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) fail(op, error);
  }

  return {
    async deleteTranscript(userId, sessionId) {
      if (!(await ownsSession(userId, sessionId, "deleteTranscript"))) return false;
      await purge("deleteTranscript", userId, sessionId);
      const { error } = await client
        .from("interview_sessions")
        .update({ transcript: null, recording_url: null })
        .eq("id", sessionId)
        .eq("user_id", userId);
      if (error) fail("deleteTranscript", error);
      return true;
    },

    async deleteSession(userId, sessionId) {
      if (!(await ownsSession(userId, sessionId, "deleteSession"))) return false;
      await purge("deleteSession", userId, sessionId);
      const { error } = await client
        .from("interview_sessions")
        .delete()
        .eq("id", sessionId)
        .eq("user_id", userId);
      if (error) fail("deleteSession", error);
      return true;
    },

    async deleteAccount(userId) {
      await purge("deleteAccount", userId, null);
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) fail("deleteAccount");
    },
  };
}
