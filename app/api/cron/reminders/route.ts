import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { isAuthorizedCron, runReminders } from "@/lib/notifications/reminders";
import { createReminderDeps } from "@/lib/notifications/reminders-server";

export const maxDuration = 120;

/**
 * Scheduled job (see vercel.json): booking reminders and "finish your
 * application" nudges. Not for browsers: it needs `Authorization: Bearer
 * $CRON_SECRET`, which Vercel Cron sends when CRON_SECRET is set.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "CRON_SECRET is not set." });
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET.trim())) {
    return jsonResponse(401, { success: false, error: "unauthorized", message: "Unauthorized." });
  }
  try {
    return jsonResponse(200, { success: true, ...(await runReminders(createReminderDeps(), new Date())) });
  } catch (err) {
    console.error("[reminders] run failed", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
