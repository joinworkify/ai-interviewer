import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

/**
 * Persistence for interview sessions and their AI feedback.
 *
 * `createSupabaseSessionStore` must be given the service-role (admin) client.
 * Browsers have no insert/update/delete on `interview_sessions` or `feedback`
 * (see 20261112000004_ai_security_hardening.sql), so all writes happen here,
 * and the service role bypasses Row Level Security. RLS therefore protects
 * nothing in this module: every query is filtered by the verified user id,
 * which comes from `getUserId` (a verified JWT claim, never the request body).
 * Handlers also compare `user_id` themselves; this is the second layer.
 */

export type SessionStatus = "in_progress" | "completed" | "abandoned";

export interface InterviewRecord {
  id: string;
  questions: string[];
}

export interface SessionRecord {
  id: string;
  interview_id: string;
  user_id: string;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  /** Raw jsonb written by the Vapi webhook; shape is normalized on use. */
  transcript: unknown;
}

export interface PerAnswerRecord {
  questionIndex: number;
  question: string;
  /** Exact text the user submitted, or the model's summary for transcripts. */
  answer: string;
  /** "submitted": answer is verbatim. "transcript": answer is a model summary. */
  source: "submitted" | "transcript";
  score: number;
  feedback: string;
}

export interface FeedbackRecord {
  id: string;
  session_id: string;
  user_id: string;
  total_score: number | null;
  strengths: string[];
  areas_for_improvement: string[];
  final_assessment: string | null;
  per_answer: PerAnswerRecord[];
  created_at: string;
}

export type NewFeedback = Omit<FeedbackRecord, "id" | "created_at">;

export class DuplicateFeedbackError extends Error {}
export class SessionStoreError extends Error {}

export interface SessionStore {
  getInterview(interviewId: string): Promise<InterviewRecord | null>;
  createSession(userId: string, interviewId: string): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  getFeedback(sessionId: string): Promise<FeedbackRecord | null>;
  insertFeedback(row: NewFeedback): Promise<FeedbackRecord>;
  completeSession(sessionId: string, endedAtIso: string): Promise<void>;
}

const PG_UNIQUE_VIOLATION = "23505";
const SESSION_COLUMNS =
  "id, interview_id, user_id, status, started_at, ended_at, transcript";
const FEEDBACK_COLUMNS =
  "id, session_id, user_id, total_score, strengths, areas_for_improvement, final_assessment, per_answer, created_at";

/**
 * `reason` is a static string from this file, or a Supabase error (only its
 * Postgres code is logged: messages can quote row or JSON values).
 */
function fail(op: string, reason: string | { code?: string }): never {
  const detail = typeof reason === "string" ? reason : (reason.code ?? "");
  console.error(`[sessions] ${op} failed:`, detail);
  throw new SessionStoreError(`${op} failed`);
}

function toFeedback(row: {
  id: string;
  session_id: string;
  user_id: string;
  total_score: number | null;
  strengths: string[];
  areas_for_improvement: string[];
  final_assessment: string | null;
  per_answer: Json | null;
  created_at: string;
}): FeedbackRecord {
  return {
    ...row,
    per_answer: Array.isArray(row.per_answer)
      ? (row.per_answer as unknown as PerAnswerRecord[])
      : [],
  };
}

export function createSupabaseSessionStore(
  client: SupabaseClient<Database>,
  getUserId: () => Promise<string | null>,
): SessionStore {
  /** The verified user; throws before any query when there is none. */
  async function uid(): Promise<string> {
    const id = await getUserId();
    if (!id) fail("auth", "no verified user");
    return id;
  }

  return {
    async getInterview(interviewId) {
      const userId = await uid();
      const { data, error } = await client
        .from("interviews")
        .select("id, questions")
        .eq("id", interviewId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getInterview", error);
      return data;
    },

    async createSession(userId, interviewId) {
      const verified = await uid();
      if (userId !== verified) fail("createSession", "user mismatch");
      // The old insert policy checked this; the service role does not.
      const owned = await client
        .from("interviews")
        .select("id")
        .eq("id", interviewId)
        .eq("user_id", verified)
        .maybeSingle();
      if (owned.error) fail("createSession", owned.error);
      if (!owned.data) fail("createSession", "interview not owned by user");

      const { data, error } = await client
        .from("interview_sessions")
        .insert({ user_id: verified, interview_id: interviewId })
        .select(SESSION_COLUMNS)
        .single();
      if (error) fail("createSession", error);
      return data as SessionRecord;
    },

    async getSession(sessionId) {
      const userId = await uid();
      const { data, error } = await client
        .from("interview_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getSession", error);
      return data as SessionRecord | null;
    },

    async getFeedback(sessionId) {
      const userId = await uid();
      const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_COLUMNS)
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getFeedback", error);
      return data ? toFeedback(data) : null;
    },

    async insertFeedback(row) {
      const verified = await uid();
      if (row.user_id !== verified) fail("insertFeedback", "user mismatch");
      // The old insert policy checked this; the service role does not.
      const owned = await client
        .from("interview_sessions")
        .select("id")
        .eq("id", row.session_id)
        .eq("user_id", verified)
        .maybeSingle();
      if (owned.error) fail("insertFeedback", owned.error);
      if (!owned.data) fail("insertFeedback", "session not owned by user");

      const { data, error } = await client
        .from("feedback")
        .insert({
          ...row,
          user_id: verified,
          per_answer: row.per_answer as unknown as Json,
        })
        .select(FEEDBACK_COLUMNS)
        .single();
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          throw new DuplicateFeedbackError("feedback already exists");
        }
        fail("insertFeedback", error);
      }
      return toFeedback(data);
    },

    async completeSession(sessionId, endedAtIso) {
      const userId = await uid();
      const { error } = await client
        .from("interview_sessions")
        .update({ status: "completed", ended_at: endedAtIso })
        .eq("id", sessionId)
        .eq("user_id", userId);
      if (error) fail("completeSession", error);
    },
  };
}
