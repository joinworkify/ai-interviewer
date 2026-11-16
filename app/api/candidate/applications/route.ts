
import { jsonResponse } from "@/lib/http/json";
import { attemptProgress } from "@/lib/candidate/attempts";
import roles from "@/lib/candidate/roles.json";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  // Opt out of prerendering before entering the try/catch.
  // Next.js must be allowed to handle its internal prerendering signal.
  void request.headers.get("cookie");

  try {
    const supabase = await createClient();

    // Verify the signed-in candidate.
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();

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

    // Load only the candidate's own interview sessions.
    const { data: sessions, error: sessionError } = await supabase
      .from("interview_sessions")
      .select("id, user_id, interview_id, status, transcript")
      .eq("user_id", userId)
      .in("id", sessionIds);

    if (sessionError) throw sessionError;

    const validSessions = (sessions ?? []).filter(
      (session) => session.user_id === userId,
    );

    const interviewIds = [
      ...new Set(validSessions.map((session) => session.interview_id)),
    ];

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

    const roleTitles = new Map(
      (roles as { id: string; title: string }[]).map((role) => [
        role.id,
        role.title,
      ]),
    );

    const applications = consents.flatMap((consent) => {
      const session = sessionById.get(consent.session_id);

      if (!session || consent.user_id !== userId) return [];

      return [{
        id: consent.id,
        roleId: consent.role_id,
        roleTitle: roleTitles.get(consent.role_id) ?? "Unknown role",
        appliedAt: consent.accepted_at,
        status: attemptProgress(session),
      }];
    });

    return jsonResponse(200, {
      success: true,
      applications,
    });
  } catch (error) {
    console.error("[candidate-applications] failed", error);

    return jsonResponse(500, {
      success: false,
      error: "storage_failed",
      message: "Could not load your applications.",
    });
  }
}
