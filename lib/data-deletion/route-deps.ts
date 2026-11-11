import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { DeletionHandlerDeps } from "./handlers";
import { createSupabaseDeletionStore } from "./store";

/**
 * Builds real dependencies for the deletion route handlers and turns
 * unexpected failures into JSON responses. Server-only, like
 * lib/sessions/route-deps.ts, so the handlers stay importable in unit tests.
 */
export async function runDeletionRoute(
  run: (deps: DeletionHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY],
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
      // Verified JWT claim (not the unverified session), like the sessions routes.
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: createSupabaseDeletionStore(createAdminClient()),
      // Clears the auth cookies of the account that no longer exists.
      afterAccountDeleted: async () => {
        await supabase.auth.signOut();
      },
    });
  } catch {
    console.error("[deletion] unhandled error");
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
