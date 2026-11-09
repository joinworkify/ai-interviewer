import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { InterviewType } from "./validation";

/**
 * Persistence for generated interviews.
 *
 * The Vapi tool request has no Supabase session (it comes from Vapi's servers,
 * not the user's browser), so the insert uses a server-only Supabase secret
 * key. That key bypasses RLS, so this module is deliberately narrow:
 *  - it only touches `public.interviews`;
 *  - `user_id` always comes from a verified capability token;
 *  - `generation_id` (the token's jti) is UNIQUE, so one capability can
 *    create at most one interview.
 * Users can only read (SELECT) their own rows through RLS with their normal
 * session. There is deliberately no browser DELETE: the row is the
 * capability's single-use record, so deleting it would allow replay.
 */

export interface NewInterviewRow {
  user_id: string;
  generation_id: string;
  role: string;
  level: string;
  type: InterviewType;
  techstack: string[];
  questions: string[];
}

export class DuplicateGenerationError extends Error {}
export class StoreError extends Error {}

export interface InterviewStore {
  generationExists(generationId: string): Promise<boolean>;
  insert(row: NewInterviewRow): Promise<{ id: string }>;
}

export type StoreConfigResult =
  | { ok: true; url: string; secretKey: string }
  | { ok: false; missing: string[] };

export function readStoreConfig(
  env: Record<string, string | undefined>,
): StoreConfigResult {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!secretKey) missing.push("SUPABASE_SECRET_KEY");
  if (!url || !secretKey) return { ok: false, missing };
  return { ok: true, url, secretKey };
}

const PG_UNIQUE_VIOLATION = "23505";

export function createSupabaseInterviewStore(
  url: string,
  secretKey: string,
): InterviewStore {
  // New client per request; never persisted or shared with the browser.
  const client: SupabaseClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async generationExists(generationId) {
      const { data, error } = await client
        .from("interviews")
        .select("id")
        .eq("generation_id", generationId)
        .maybeSingle();
      if (error) {
        console.error("[generate-interview] lookup failed:", error.message);
        throw new StoreError(error.message);
      }
      return data !== null;
    },

    async insert(row) {
      const { data, error } = await client
        .from("interviews")
        .insert(row)
        .select("id")
        .single();
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          throw new DuplicateGenerationError(error.message);
        }
        console.error("[generate-interview] insert failed:", error.message);
        throw new StoreError(error.message);
      }
      return { id: (data as { id: string }).id };
    },
  };
}
