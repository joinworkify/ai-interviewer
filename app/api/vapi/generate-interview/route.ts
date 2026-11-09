import { handleGenerateInterview } from "@/lib/interviews/generate-handler";

/**
 * Called by the Vapi "API Request" tool on the Generator Assistant, not by
 * the browser. It is exempted from the Supabase session redirect in
 * `lib/supabase/proxy.ts`; authorization is the signed capability token
 * (see lib/interviews/capability.ts). Setup: VAPI_SETUP.md.
 */
export async function POST(request: Request) {
  try {
    return await handleGenerateInterview(request, { env: process.env });
  } catch (err) {
    console.error("[generate-interview] unhandled error", err);
    return Response.json(
      { success: false, error: "internal_error", message: "Internal error." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
