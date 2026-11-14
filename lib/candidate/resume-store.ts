import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import type { ResumeStore } from "./resume";

/**
 * Must be given the service-role (admin) client: browsers cannot write
 * `candidate_resumes`. RLS protects nothing here, so every query is pinned to
 * the user id the route verified from the JWT claims.
 */
export function createSupabaseResumeStore(client: SupabaseClient<Database>): ResumeStore {
  const fail = (op: string, error: unknown): never => {
    console.error(`[candidate-resume] ${op} failed:`, describeError(error));
    throw new Error(`${op} failed`);
  };

  return {
    async createPending({ userId, key, fileName, contentType, size }) {
      const { data, error } = await client
        .from("candidate_resumes")
        .insert({
          user_id: userId,
          s3_key: key,
          file_name: fileName,
          content_type: contentType,
          size_bytes: size,
        })
        .select("id")
        .single();
      if (error || !data) return fail("insert", error);
      return { id: data.id };
    },

    async get(userId, id) {
      const { data, error } = await client
        .from("candidate_resumes")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return fail("get", error);
      return data;
    },

    async markUploaded(userId, id) {
      const { data, error } = await client
        .from("candidate_resumes")
        .update({ status: "uploaded", uploaded_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error || !data) return fail("markUploaded", error);
      return data;
    },

    async latestUploaded(userId) {
      const { data, error } = await client
        .from("candidate_resumes")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "uploaded")
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return fail("latestUploaded", error);
      return data;
    },
  };
}
