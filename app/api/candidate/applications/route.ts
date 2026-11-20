import { jsonResponse } from "@/lib/http/json";
import type { ReviewStatus } from "@/lib/admin/access";
import {
  attemptProgress,
  attemptsTowardLimit,
  MAX_ATTEMPTS_PER_ROLE,
} from "@/lib/candidate/attempts";
import { describeError } from "@/lib/log/safe-error";
import { applicationStage } from "@/lib/candidate/stage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  // Opt out of prerendering before entering the try/catch.
  // Next.js must be allowed to handle its internal prerendering signal.
  void request.headers.get("cookie");

  try {
    const supabase = await createClient();

    // Verify the signed-in candidate.
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

    const userId = claimsData?.claims?.sub;

    if (claimsError || typeof userId !== "string") {
      return jsonResponse(401, {
        success: false,
        error: "unauthorized",
        message: "Sign in to view your applications.",
      });
    }

    // Load only this candidate's application consent records.
    const { data: consents, error: consentError } = await supabase
      .from("candidate_consents")
      .select("id, user_id, session_id, role_id, accepted_at")
      .eq("user_id", userId)
      .order("accepted_at", { ascending: false });

    if (consentError) throw consentError;

    if (!consents?.length) {
      return jsonResponse(200, {
        success: true,
        applications: [],
      });
    }

    const sessionIds = consents.map((item) => item.session_id);
    const roleIds = [...new Set(consents.map((item) => item.role_id).filter(Boolean))];

    // Load only the candidate's own interview sessions and the referenced roles.
    const [{ data: sessions, error: sessionError }, { data: rolesData, error: rolesError }] =
      await Promise.all([
        supabase
          .from("interview_sessions")
          .select("id, user_id, interview_id, status, transcript, ended_reason")
          .eq("user_id", userId)
          .in("id", sessionIds),
        roleIds.length > 0
          ? supabase.from("roles").select("id, title").in("id", roleIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (sessionError) throw sessionError;
    if (rolesError) throw rolesError;

    const validSessions = (sessions ?? []).filter((session) => session.user_id === userId);

    const interviewIds = [...new Set(validSessions.map((session) => session.interview_id))];

    if (!interviewIds.length) {
      return jsonResponse(200, {
        success: true,
        applications: [],
      });
    }

    // Confirm that the related interview records belong to this candidate.
    const { data: interviews, error: interviewError } = await supabase
      .from("interviews")
      .select("id, user_id")
      .eq("user_id", userId)
      .in("id", interviewIds);

    if (interviewError) throw interviewError;

    const validInterviewIds = new Set(
      (interviews ?? [])
        .filter((interview) => interview.user_id === userId)
        .map((interview) => interview.id),
    );

    const sessionById = new Map(
      validSessions
        .filter((session) => validInterviewIds.has(session.interview_id))
        .map((session) => [session.id, session]),
    );

    const roleTitles = new Map((rolesData ?? []).map((role) => [role.id, role.title]));

    // Reviewer statuses are not readable by browsers, so they are read with the
    // service role, only for this candidate's own sessions (ids checked above),
    // and only the derived stage is returned.
    const reviewBySession = new Map<string, ReviewStatus>();
    if (sessionById.size > 0) {
      const { data: reviews, error: reviewError } = await createAdminClient()
        .from("interview_reviews")
        .select("session_id, status")
        .in("session_id", [...sessionById.keys()]);
      if (reviewError) throw reviewError;
      for (const r of reviews ?? []) reviewBySession.set(r.session_id, r.status);
    }

    // Attempts left per role, counted like the start-an-attempt check does:
    // abandoned attempts and the first dropped call are free.
    const reasonsByRole = new Map<string, (string | null)[]>();
    for (const consent of consents) {
      const session = sessionById.get(consent.session_id);
      if (!session || session.status === "abandoned") continue;
      reasonsByRole.set(consent.role_id, [
        ...(reasonsByRole.get(consent.role_id) ?? []),
        session.ended_reason ?? null,
      ]);
    }
    const attemptsLeft = (roleId: string) =>
      Math.max(0, MAX_ATTEMPTS_PER_ROLE - attemptsTowardLimit(reasonsByRole.get(roleId) ?? []));

    const applications = consents.flatMap((consent) => {
      const session = sessionById.get(consent.session_id);

      if (!session || consent.user_id !== userId) return [];

      return [
        {
          id: consent.id,
          roleId: consent.role_id,
          roleTitle: roleTitles.get(consent.role_id) ?? "Unknown role",
          appliedAt: consent.accepted_at,
          status: attemptProgress(session),
          attemptsLeft: attemptsLeft(consent.role_id),
          stage: applicationStage(
            attemptProgress(session),
            reviewBySession.get(session.id) ?? null,
          ),
        },
      ];
    });

    return jsonResponse(200, {
      success: true,
      applications,
    });
  } catch (error) {
    console.error("[candidate-applications] failed", describeError(error));

    return jsonResponse(500, {
      success: false,
      error: "storage_failed",
      message: "Could not load your applications.",
    });
  }
}
