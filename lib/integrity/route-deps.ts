import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { IntegrityHandlerDeps } from "./handler";
import { createSupabaseIntegrityStore } from "./store";

export async function runIntegrityRoute(
  run: (deps: IntegrityHandlerDeps) => Promise<Response>,
): Promise<Response> {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "Supabase is not configured on the server.", missing });
  }
  try {
    const supabase = await createClient();
    return await run({
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: createSupabaseIntegrityStore(createAdminClient()),
    });
  } catch (err) {
    console.error("[integrity] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
