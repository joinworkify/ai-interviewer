import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Persistence for generated interviews.
 *
 * The Vapi tool request has no Supabase session (it comes from Vapi's servers,
 * not the user's browser), so the insert uses a server-only Supabase secret
 * key. That key bypasses RLS, so this module is deliberately narrow:
 *  - it only touches `public.interviews`;
 *  - `user_id` always comes from a verified capability token;
 *  - the schema no longer records a per-capability row, so replay protection
 *    relies on the capability token's short expiry.
 * Users can only read (SELECT) their own rows through RLS with their normal
 * session.
 */

export interface NewInterviewRow {
  user_id: string;
  questions: string[];
  duration_minutes?: number | null;
}

export class StoreError extends Error {}

export interface InterviewStore {
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

export function createSupabaseInterviewStore(
  url: string,
  secretKey: string,
): InterviewStore {
  // New client per request; never persisted or shared with the browser.
  const client: SupabaseClient = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async insert(row) {
      const { data, error } = await client
        .from("interviews")
        .insert(row)
        .select("id")
        .single();
      if (error) {
        console.error("[generate-interview] insert failed:", error.message);
        throw new StoreError(error.message);
      }
      return { id: (data as { id: string }).id };
    },
  };
}
