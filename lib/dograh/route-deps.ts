import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import { createSupabaseTranscriptStore } from "@/lib/transcripts/store";

import type { DograhWebhookDeps } from "./webhook-handler";

/**
 * Real dependencies for POST /api/dograh/webhook. There is no browser session
 * on this path: Dograh calls it server to server, and the handler authenticates
 * the caller itself. The write goes through the server-only admin client, the
 * same way the transcript route does (see lib/transcripts/store.ts).
 */
export async function runDograhWebhookRoute(
  run: (deps: DograhWebhookDeps) => Promise<Response>,
): Promise<Response> {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    [
      "SUPABASE_SECRET_KEY",
      // `||`, not `??`: a blank SUPABASE_SECRET_KEY must fall back, as in admin.ts.
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    ],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    // Names only go to the log: this caller may not be authenticated yet.
    console.error(`[dograh-webhook] missing server configuration: ${missing.join(", ")}`);
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Webhook is not configured.",
    });
  }

  try {
    return await run({
      env: process.env,
      store: createSupabaseTranscriptStore(createAdminClient()),
      adapters: defaultAdapters,
    });
  } catch {
    console.error("[dograh-webhook] unhandled error");
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
