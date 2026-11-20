import "server-only";

import { after } from "next/server";

import { reviewSessionAudio } from "@/lib/integrity/audio-review-server";
import { createS3Client, createS3ResumeStorage, readResumeS3Config } from "@/lib/candidate/resume-s3";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { RecordingHandlerDeps } from "./recording";
import { createSupabaseRecordingStore } from "./store";

/** Real dependencies for the /api/sessions/:id/recording routes. */
export async function runRecordingRoute(
  run: (deps: RecordingHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
  const missingSupabase = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missingSupabase.length > 0) {
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Supabase is not configured on the server.",
      missing: missingSupabase,
    });
  }

  const s3 = readResumeS3Config(process.env);
  if (!s3.ok) {
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Recording storage is not configured.",
      missing: s3.missing,
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
      store: createSupabaseRecordingStore(createAdminClient()),
      storage: createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket),
      // After the response: the model listens to the recording (best effort).
      onUploaded: ({ sessionId }) => {
        after(async () => {
          await reviewSessionAudio(sessionId);
        });
      },
    });
  } catch (err) {
    console.error("[recording] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
