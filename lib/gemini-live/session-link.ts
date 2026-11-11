import type { SessionStore } from "@/lib/sessions/store";

/**
 * Links a Gemini Live token request to one of the user's interview sessions,
 * so the interviewer asks what was stored and feedback scores that.
 */
export type LinkedSession =
  | { kind: "ok"; questions: string[] }
  | { kind: "not_found" }
  | { kind: "closed" };

export type SessionLinkLookup = (
  userId: string,
  sessionId: string,
) => Promise<LinkedSession>;

export function createSessionLinkLookup(
  store: Pick<SessionStore, "getSession" | "getInterview">,
): SessionLinkLookup {
  return async (userId, sessionId) => {
    const session = await store.getSession(sessionId);
    // Compared explicitly so a store on an RLS-bypassing client cannot leak rows.
    if (!session || session.user_id !== userId) return { kind: "not_found" };
    if (session.status !== "in_progress" || session.transcript != null) {
      return { kind: "closed" };
    }
    const interview = await store.getInterview(session.interview_id);
    if (!interview) return { kind: "not_found" };
    return { kind: "ok", questions: interview.questions };
  };
}
