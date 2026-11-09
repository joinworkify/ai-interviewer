import { createClient } from "@/lib/supabase/server";
import {
  CAPABILITY_TTL_SECONDS,
  issueCapability,
  SigningSecretError,
} from "@/lib/interviews/capability";

/**
 * Issues a short-lived generation capability for the signed-in user.
 * The user id comes from the verified Supabase session claims only.
 */
export async function POST() {
  const noStore = { "cache-control": "no-store" };

  // Check before createClient(): the Supabase client throws without these.
  // Only public variable names are reported, never values. Literal
  // process.env.NEXT_PUBLIC_* access matches what createClient() sees
  // (Next.js inlines these at build time).
  const missingSupabase = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missingSupabase.length > 0) {
    return Response.json(
      {
        error: "server_misconfigured",
        message: `Supabase is not configured on the server. Set ${missingSupabase.join(
          " and ",
        )} (see .env.example and VAPI_SETUP.md), then restart or redeploy.`,
        missing: missingSupabase,
      },
      { status: 503, headers: noStore },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return Response.json(
      { error: "unauthorized", message: "Sign in to start an interview." },
      { status: 401, headers: noStore },
    );
  }

  try {
    const { token, payload } = issueCapability(
      userId,
      process.env.VAPI_TOOL_SIGNING_SECRET,
    );
    return Response.json(
      { token, expiresAt: payload.exp, ttlSeconds: CAPABILITY_TTL_SECONDS },
      { headers: noStore },
    );
  } catch (err) {
    if (err instanceof SigningSecretError) {
      return Response.json(
        {
          error: "server_misconfigured",
          message:
            "VAPI_TOOL_SIGNING_SECRET is not set (or shorter than 32 characters) on the server. See VAPI_SETUP.md.",
        },
        { status: 503, headers: noStore },
      );
    }
    console.error("[interview-capability] failed to issue capability", err);
    return Response.json(
      { error: "internal_error", message: "Could not start the interview." },
      { status: 500, headers: noStore },
    );
  }
}
