import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

import type { CanonicalTurn, TranscriptMetadata } from "./types";

export interface StoreTranscriptInput {
  sessionId: string;
  userId: string;
  transcript: CanonicalTurn[];
  metadata: TranscriptMetadata;
  endedAtIso: string;
}

export type StoreTranscriptOutcome =
  | { kind: "stored"; status: "completed" | "abandoned" }
  | { kind: "already_stored" }
  | { kind: "not_found" };

export class TranscriptStoreError extends Error {}

export interface TranscriptStore {
  /**
   * Writes the transcript only if the session is the user's and has none yet.
   * Concurrent callers cannot both get "stored".
   */
  storeOnce(input: StoreTranscriptInput): Promise<StoreTranscriptOutcome>;
}

function fail(op: string, message: string): never {
  console.error(`[transcripts] ${op} failed:`, message);
  throw new TranscriptStoreError(`${op} failed`);
}

/**
 * Meant for the server-only admin client: the browser may lose its write
 * grants without breaking this path. The service role bypasses RLS, so the
 * `user_id` filter inside `store_session_transcript` is the access check.
 */
export function createSupabaseTranscriptStore(
  admin: SupabaseClient<Database>,
): TranscriptStore {
  return {
    async storeOnce(input) {
      const { data, error } = await admin.rpc("store_session_transcript", {
        p_session_id: input.sessionId,
        p_user_id: input.userId,
        p_transcript: input.transcript as unknown as Json,
        p_source: input.metadata.source,
        p_duration_seconds: input.metadata.durationSeconds,
        p_ended_reason: input.metadata.endedReason,
        p_ended_at: input.endedAtIso,
      });
      if (error) fail("storeOnce", error.message);

      const row = data?.[0];
      if (row) {
        return {
          kind: "stored",
          status: row.status === "abandoned" ? "abandoned" : "completed",
        };
      }

      // No row updated: tell "already has a transcript" from "not yours / missing".
      const existing = await admin
        .from("interview_sessions")
        .select("id")
        .eq("id", input.sessionId)
        .eq("user_id", input.userId)
        .maybeSingle();
      if (existing.error) fail("storeOnce lookup", existing.error.message);
      return existing.data ? { kind: "already_stored" } : { kind: "not_found" };
    },
  };
}
