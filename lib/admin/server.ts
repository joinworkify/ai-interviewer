import "server-only";

import { notFound } from "next/navigation";
import { after, connection } from "next/server";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { announceStage } from "@/lib/notifications/events";
import { notifiableStage } from "@/lib/candidate/stage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { isAdminClaims } from "./access";
import type { ReviewHandlerDeps } from "./review";

/** The signed-in caller from verified claims, or null when signed out. */
export async function getCaller(): Promise<{ userId: string; isAdmin: boolean } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string") return null;
  return { userId: sub, isAdmin: isAdminClaims(data?.claims) };
}

/**
 * For admin pages: 404 unless the caller is an admin. Pages call this
 * themselves because a layout and its page render in parallel.
 */
export async function requireAdmin(): Promise<void> {
  // Admin pages are per request; never prerendered.
  await connection();
  const caller = await getCaller();
  if (!caller?.isAdmin) notFound();
}

/** Names of missing Supabase settings (names only, never values). */
export function missingSupabaseEnv(): string[] {
  return [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    [
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
}

/** Real dependencies for the admin review route. */
export async function runReviewRoute(
  run: (deps: ReviewHandlerDeps) => Promise<Response>,
): Promise<Response> {
  const missing = missingSupabaseEnv();
  if (missing.length > 0) {
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Supabase is not configured on the server.",
      missing,
    });
  }

  try {
    const admin = createAdminClient();
    return await run({
      getCaller,
      // After the response: tell the candidate in the app, and by email when
      // the admin ticked "Email the candidate".
      onStatusSet: ({ sessionId, status, notify }) => {
        const stage = notifiableStage(status);
        if (!stage) return;
        after(() => announceStage(sessionId, stage, { email: notify }));
      },
      store: {
        async sessionExists(sessionId) {
          const { data, error } = await admin
            .from("interview_sessions")
            .select("id")
            .eq("id", sessionId)
            .maybeSingle();
          if (error) throw error;
          return data !== null;
        },
        async setStatus(sessionId, status, adminId) {
          const { data, error } = await admin
            .from("interview_reviews")
            .upsert({
              session_id: sessionId,
              status,
              updated_by: adminId,
              updated_at: new Date().toISOString(),
            })
            .select("updated_at")
            .single();
          if (error || !data) {
            console.error("[admin-review] save failed:", describeError(error));
            throw new Error("setStatus failed");
          }
          return { updatedAt: data.updated_at };
        },
      },
    });
  } catch (err) {
    console.error("[admin-review] unhandled error", describeError(err));
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
