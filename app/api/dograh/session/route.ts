import { createSessionLinkLookup } from "@/lib/gemini-live/session-link";
import { SlidingWindowLimiter } from "@/lib/gemini-live/rate-limit";
import type { AuthResult } from "@/lib/gemini-live/token-handler";
import { handleDograhSession } from "@/lib/dograh/session-handler";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { createSupabaseSessionStore } from "@/lib/sessions/store";
import { createClient } from "@/lib/supabase/server";

/**
 * Prepares a Dograh call for the signed-in user: checks the interview session
 * is theirs and open, and returns the signed context for the Dograh widget.
 * See DOGRAH_SETUP.md. POST handlers are never cached; responses also carry
 * `cache-control: no-store`.
 */

// PROTOTYPE: in-memory, per server instance (resets on restart, not shared
// across instances). 5 calls per user per 10 minutes.
const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 10 * 60_000 });

async function authenticate(): Promise<AuthResult> {
  // Literal NEXT_PUBLIC_* access matches what createClient() sees (inlined at
  // build time); the client throws without these.
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return { ok: false, reason: "supabase_unconfigured", missing };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string" || !userId) {
    return { ok: false, reason: "unauthenticated" };
  }
  return { ok: true, userId };
}

export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  try {
    return await handleDograhSession(request, {
      env: process.env,
      authenticate,
      limiter,
      // Read-only lookup with the signed-in user's own client (RLS select-own),
      // pinned to the user id verified by authenticate().
      lookupSession: async (userId, sessionId) =>
        createSessionLinkLookup(
          createSupabaseSessionStore(await createClient(), async () => userId),
        )(userId, sessionId),
    });
  } catch {
    console.error("[dograh-session] unhandled error");
    return Response.json(
      { success: false, error: "internal_error", message: "Could not start the interview." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
