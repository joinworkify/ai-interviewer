import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { ResumeHandlerDeps } from "./resume";
import { createS3Client, createS3ResumeStorage, readResumeS3Config } from "./resume-s3";
import { createSupabaseResumeStore } from "./resume-store";

/**
 * Real dependencies for the /api/candidate/resume routes, like
 * lib/candidate/route-deps.ts. Kept out of resume.ts so the handlers stay
 * importable in unit tests (this file imports `server-only`).
 */
export async function runResumeRoute(
  run: (deps: ResumeHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
  const missingSupabase = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    [
      "SUPABASE_SECRET_KEY",
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    ],
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
      message: "Resume storage is not configured.",
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
      store: createSupabaseResumeStore(createAdminClient()),
      storage: createS3ResumeStorage(createS3Client(s3.config), s3.config.bucket),
    });
  } catch (err) {
    console.error("[candidate-resume] unhandled error", describeError(err));
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
