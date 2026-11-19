import { getCaller } from "@/lib/admin/server";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { isUuid } from "@/lib/sessions/validation";
import { createAdminClient } from "@/lib/supabase/admin";

/** Admins only: delete a calibration case and its runs. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const caller = await getCaller();
  if (!caller) return jsonResponse(401, { success: false, error: "unauthorized", message: "Sign in required." });
  if (!caller.isAdmin) return jsonResponse(403, { success: false, error: "forbidden", message: "Admins only." });
  const { id } = await params;
  if (!isUuid(id)) return jsonResponse(400, { success: false, error: "invalid_request", message: "Invalid id." });
  try {
    const { error } = await createAdminClient().from("calibration_cases").delete().eq("id", id);
    if (error) throw error;
    return jsonResponse(200, { success: true });
  } catch (err) {
    console.error("[calibration] delete failed", describeError(err));
    return jsonResponse(500, { success: false, error: "storage_failed", message: "Could not delete." });
  }
}
