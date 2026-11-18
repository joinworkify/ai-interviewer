import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { ProfileHandlerDeps } from "./profile";
import { createSupabaseProfileStore } from "./profile-store";

/**
 * Real dependencies for /api/candidate/profile, like resume-route-deps.ts.
 * Kept out of profile.ts so the handler stays importable in unit tests.
 */
export async function runProfileRoute(
  run: (deps: ProfileHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    [
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Supabase is not configured on the server.",
      missing,
    });
  }

  try {
    const supabase = await createClient();
    return await run({
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: createSupabaseProfileStore(createAdminClient()),
    });
  } catch (err) {
    console.error("[candidate-profile] unhandled error", describeError(err));
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
