import { getCaller } from "@/lib/admin/server";
import { runCalibrationCase } from "@/lib/evaluation/calibration-server";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { isUuid } from "@/lib/sessions/validation";

export const maxDuration = 120;
const MAX_REPEATS = 3;

/** Admins only: have the AI score a calibration case (1-3 times, to see how stable it is). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const caller = await getCaller();
  if (!caller) return jsonResponse(401, { success: false, error: "unauthorized", message: "Sign in required." });
  if (!caller.isAdmin) return jsonResponse(403, { success: false, error: "forbidden", message: "Admins only." });
  const { id } = await params;
  if (!isUuid(id)) return jsonResponse(400, { success: false, error: "invalid_request", message: "Invalid id." });

  const repeatsRaw = Number(new URL(request.url).searchParams.get("repeats") ?? "1");
  const repeats = Number.isInteger(repeatsRaw) ? Math.min(Math.max(repeatsRaw, 1), MAX_REPEATS) : 1;
  try {
    const overalls: number[] = [];
    for (let i = 0; i < repeats; i++) overalls.push((await runCalibrationCase(id)).overall);
    return jsonResponse(200, { success: true, overalls });
  } catch (err) {
    console.error("[calibration] run failed", describeError(err));
    return jsonResponse(502, { success: false, error: "llm_failed", message: "The model could not score this case. Check the model settings and try again." });
  }
}
