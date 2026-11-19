import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { RecordingStore } from "./recording";

/**
 * Persistence for interview recordings. Needs the service-role client: the
 * table has no browser access, so every query here filters by the verified
 * user or session itself.
 */

function fail(op: string, error: { code?: string } | null): never {
  // Op name and Postgres code only: messages can quote row values.
  console.error(`[recording-store] ${op} failed`, error?.code ?? "");
  throw new Error(`${op} failed`);
}

export function createSupabaseRecordingStore(db: SupabaseClient<Database>): RecordingStore {
  return {
    async ownsSession(userId, sessionId) {
      const { data, error } = await db
        .from("interview_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("ownsSession", error);
      return data !== null;
    },

    async get(sessionId) {
      const { data, error } = await db
        .from("interview_recordings")
        .select("session_id, user_id, s3_key, content_type, size_bytes, status")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) fail("get", error);
      return data;
    },

    async savePending(row) {
      const { error } = await db.from("interview_recordings").upsert({ ...row, status: "pending", uploaded_at: null });
      if (error) fail("savePending", error);
    },

    async markUploaded(sessionId) {
      const { error } = await db
        .from("interview_recordings")
        .update({ status: "uploaded", uploaded_at: new Date().toISOString() })
        .eq("session_id", sessionId);
      if (error) fail("markUploaded", error);
    },
  };
}
