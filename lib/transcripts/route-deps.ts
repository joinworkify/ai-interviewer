import "server-only";

import { after } from "next/server";

import { createSupabaseUsageStore } from "@/lib/ai/usage";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { evaluateSession } from "@/lib/evaluation/store";
import { announceStage } from "@/lib/notifications/events";
import { evaluateStoredSession } from "@/lib/sessions/auto-evaluate";
import { createSupabaseSessionStore } from "@/lib/sessions/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { defaultAdapters } from "./adapters";
import type { TranscriptHandlerDeps } from "./handlers";
import { cleanTranscript } from "./cleanup";
import { createSupabaseTranscriptStore, replaceStoredTranscript } from "./store";

/**
 * Real dependencies for the transcript route. Identity comes from the
 * signed-in user's verified claims; the write itself goes through the
 * server-only admin client (see store.ts).
 */
export async function runTranscriptRoute(
  run: (deps: TranscriptHandlerDeps) => Promise<Response>,
): Promise<Response> {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    [
      "SUPABASE_SECRET_KEY",
      // `||`, not `??`: a blank SUPABASE_SECRET_KEY must fall back, as in admin.ts.
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
      store: createSupabaseTranscriptStore(createAdminClient()),
      adapters: defaultAdapters,
      // After the response: fix misheard captions, then write the AI feedback
      // for reviewers (on the cleaned text). The user id is the verified one.
      onStored: ({ userId, sessionId, transcript }) => {
        after(async () => {
          const admin = createAdminClient();
          const usage = createSupabaseUsageStore(admin);
          try {
            const cleaned = await cleanTranscript({ env: process.env, usage }, userId, transcript);
            if (cleaned) await replaceStoredTranscript(admin, sessionId, userId, cleaned);
          } catch (err) {
            console.error("[transcripts] clean-up failed", describeError(err));
          }
          try {
            await evaluateStoredSession(userId, sessionId, {
              env: process.env,
              store: createSupabaseSessionStore(admin, async () => userId),
              usage,
            });
          } catch (err) {
            console.error("[transcripts] evaluation failed", describeError(err));
          }
          // Score against the role's rubric (never throws; failures are saved).
          await evaluateSession(sessionId);
          // Tell the candidate we have their interview (only if they spoke).
          if (transcript.some((t) => t.role === "candidate" && t.text.trim().length > 0)) {
            await announceStage(sessionId, "received", { email: true });
          }
        });
      },
    });
  } catch {
    console.error("[transcripts] unhandled error");
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
