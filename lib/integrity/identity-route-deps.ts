import "server-only";

import { createS3Client, putS3Object, readResumeS3Config } from "@/lib/candidate/resume-s3";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { IdentityHandlerDeps } from "./identity";
import { createSupabaseIntegrityStore } from "./store";

export async function runIdentityRoute(
  run: (deps: IdentityHandlerDeps) => Promise<Response>,
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
  const s3 = readResumeS3Config(process.env);
  if (!s3.ok) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "Photo storage is not configured.", missing: s3.missing });
  }
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const integrity = createSupabaseIntegrityStore(admin);
    const client = createS3Client(s3.config);
    return await run({
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: {
        ownsSession: integrity.ownsSession,
        async save({ sessionId, userId, key, size }) {
          const { error } = await admin
            .from("interview_identity_photos")
            .upsert({ session_id: sessionId, user_id: userId, s3_key: key, size_bytes: size });
          if (error) {
            console.error("[identity] save failed", error.code ?? "");
            throw new Error("save failed");
          }
        },
      },
      storage: { put: (key, bytes, contentType) => putS3Object(client, s3.config.bucket, key, bytes, contentType) },
    });
  } catch (err) {
    console.error("[identity] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
