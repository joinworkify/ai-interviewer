import type { SupabaseClient } from "@supabase/supabase-js";

import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { isUuid } from "@/lib/sessions/validation";
import type { Database } from "@/types/database";

/**
 * POST /api/candidate/attempts/:id/report. A candidate tells DataSea about a
 * problem during one of their own interview attempts (lost internet, mic,
 * could not hear the interviewer). Reviewers see it on the admin page.
 */

export const PROBLEM_KINDS = ["lost_internet", "microphone", "audio", "other"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];
export const MAX_PROBLEM_MESSAGE_CHARS = 1000;
/** Enough for a real report and a retry; stops a script filling the table. */
export const MAX_REPORTS_PER_SESSION = 5;
const MAX_BODY_BYTES = 8 * 1024;

export interface ProblemReport {
  kind: ProblemKind;
  message: string;
  createdAt: string;
}

export interface ProblemReportStore {
  /** Saves the report if the session is the user's; "limit" past MAX_REPORTS_PER_SESSION. */
  add(userId: string, sessionId: string, kind: ProblemKind, message: string): Promise<"saved" | "not_found" | "limit">;
}

export interface ProblemReportDeps {
  getUserId: () => Promise<string | null>;
  problemReports?: ProblemReportStore;
}

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export async function handleReportProblem(
  request: Request,
  sessionId: string,
  deps: ProblemReportDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to report a problem.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Interview not found.");
  if (!deps.problemReports) return fail(503, "server_misconfigured", "Reports are not available.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const rec = body.value && typeof body.value === "object" ? (body.value as Record<string, unknown>) : {};
  const kind = rec.kind;
  const message = typeof rec.message === "string" ? rec.message.trim() : rec.message;
  if (!PROBLEM_KINDS.includes(kind as ProblemKind) || typeof message !== "string" || message.length > MAX_PROBLEM_MESSAGE_CHARS) {
    return fail(400, "invalid_request", "Choose a problem type and keep the message under 1000 characters.");
  }

  try {
    const outcome = await deps.problemReports.add(userId, sessionId, kind as ProblemKind, message);
    if (outcome === "not_found") return fail(404, "not_found", "Interview not found.");
    if (outcome === "limit") return fail(429, "report_limit", "You have already reported problems for this interview.");
    return jsonResponse(201, { success: true });
  } catch (err) {
    console.error("[problem-reports] save failed", describeError(err));
    return fail(500, "storage_failed", "Could not send your report.");
  }
}

/** Service-role client: the user id filter is the access check. */
export function createSupabaseProblemReportStore(admin: SupabaseClient<Database>): ProblemReportStore {
  return {
    async add(userId, sessionId, kind, message) {
      const session = await admin
        .from("interview_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (session.error) throw session.error;
      if (!session.data) return "not_found";

      const existing = await admin
        .from("interview_problem_reports")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);
      if (existing.error) throw existing.error;
      if ((existing.count ?? 0) >= MAX_REPORTS_PER_SESSION) return "limit";

      const { error } = await admin
        .from("interview_problem_reports")
        .insert({ session_id: sessionId, user_id: userId, kind, message });
      if (error) throw error;
      return "saved";
    },
  };
}
