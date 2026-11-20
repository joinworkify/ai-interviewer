import "server-only";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createSupabaseSessionStore } from "@/lib/sessions/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { createSupabaseUsageStore } from "@/lib/ai/usage";

import { MAX_ATTEMPT_QUESTIONS, type AttemptHandlerDeps } from "./attempts";
import { createSupabaseAttemptStore, createSupabaseRoleStore } from "./attempt-store";
import { createS3Client, downloadResumeFile, readResumeS3Config } from "./resume-s3";
import { extractResumeText } from "./resume-text";
import { createSupabaseProblemReportStore } from "./problem-reports";
import { generateTailoredQuestions } from "./tailored-questions";

/**
 * Real dependencies for POST /api/candidate/attempts. Identity comes from the
 * signed-in user's verified claims; the writes go through the server-only
 * admin client. Kept out of attempts.ts so the handler stays importable in
 * unit tests (this file imports `server-only`).
 */
export async function runAttemptRoute(
  run: (deps: AttemptHandlerDeps) => Promise<Response>,
): Promise<Response> {
  // Check before createClient(): it throws without these. Names only.
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
    const getUserId = async () => {
      const { data, error } = await supabase.auth.getClaims();
      const sub = data?.claims?.sub;
      return !error && typeof sub === "string" ? sub : null;
    };
    const admin = createAdminClient();
    return await run({
      getUserId,
      store: createSupabaseAttemptStore(admin),
      roles: createSupabaseRoleStore(admin),
      problemReports: createSupabaseProblemReportStore(admin),
      // Reads go through the signed-in user's own client (RLS select-own), and
      // the store pins every query to the verified user id as well.
      sessions: createSupabaseSessionStore(supabase, getUserId),
      tailorQuestions: (userId, role) =>
        generateTailoredQuestions(
          {
            env: process.env,
            usage: createSupabaseUsageStore(admin),
            loadResumeText: async (id) => {
              const s3 = readResumeS3Config(process.env);
              if (!s3.ok) return null;
              // The resume in use: last chosen, then last uploaded.
              const { data, error } = await admin
                .from("candidate_resumes")
                .select("s3_key, content_type")
                .eq("user_id", id)
                .eq("status", "uploaded")
                .order("selected_at", { ascending: false, nullsFirst: false })
                .order("uploaded_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (error) throw error;
              if (!data) return null;
              const bytes = await downloadResumeFile(
                createS3Client(s3.config),
                s3.config.bucket,
                data.s3_key,
              );
              return extractResumeText(bytes, data.content_type);
            },
          },
          userId,
          role,
          MAX_ATTEMPT_QUESTIONS,
        ),
    });
  } catch (err) {
    console.error("[candidate-attempts] unhandled error", describeError(err));
    return jsonResponse(500, {
      success: false,
      error: "internal_error",
      message: "Internal error.",
    });
  }
}
