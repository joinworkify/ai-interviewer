import { createClient } from "@/lib/supabase/server";
import { createGeminiAuthToken } from "@/lib/gemini-live/google-token";
import { createSessionLinkLookup } from "@/lib/gemini-live/session-link";
import { createSupabaseSessionStore } from "@/lib/sessions/store";
import { SlidingWindowLimiter } from "@/lib/gemini-live/rate-limit";
import {
  handleLiveTokenRequest,
  type AuthResult,
} from "@/lib/gemini-live/token-handler";

/**
 * Issues a one-use Gemini Live ephemeral token for the signed-in user.
 * Setup and architecture: GEMINI_LIVE_SETUP.md.
 * POST route handlers are always dynamic (never cached); responses also
 * carry `cache-control: no-store`.
 */

// PROTOTYPE: in-memory, per server instance (resets on restart, not shared
// across instances). 5 sessions per user per 10 minutes.
const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 10 * 60_000 });

async function authenticate(): Promise<AuthResult> {
  // Literal NEXT_PUBLIC_* access matches what createClient() sees (inlined
  // at build time); the client throws without these.
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
  try {
    return await handleLiveTokenRequest(request, {
      env: process.env,
      authenticate,
      createAuthToken: createGeminiAuthToken,
      limiter,
      lookupSession: async (userId, sessionId) =>
        createSessionLinkLookup(createSupabaseSessionStore(await createClient()))(
          userId,
          sessionId,
        ),
    });
  } catch {
    console.error("[gemini-live-token] unhandled error");
    return Response.json(
      { error: "internal_error", message: "Could not start the interview." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
