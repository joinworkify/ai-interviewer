import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseUsageStore } from "@/lib/ai/usage";
import { jsonResponse } from "@/lib/http/json";

import type { SessionHandlerDeps } from "./handlers";
import { createSupabaseSessionStore } from "./store";

/**
 * Builds real dependencies for the session route handlers and turns
 * unexpected failures into JSON responses. Kept out of `handlers.ts` so the
 * handlers stay importable in unit tests (this file imports `server-only`).
 */
export async function runSessionRoute(
  run: (deps: SessionHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ],
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
      env: process.env,
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: createSupabaseSessionStore(supabase),
      usage: createSupabaseUsageStore(createAdminClient()),
    });
  } catch (err) {
    console.error("[sessions] unhandled error", err);
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
