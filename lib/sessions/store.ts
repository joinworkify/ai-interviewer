import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

/**
 * Persistence for interview sessions and their AI feedback.
 *
 * `createSupabaseSessionStore` is meant to be given the signed-in user's own
 * Supabase client, so Row Level Security (owner-only select/insert/update, and
 * insert only for sessions/interviews the user owns) is the real access check.
 * Handlers still compare `user_id` themselves, so a store built on an
 * RLS-bypassing client cannot widen access by mistake.
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

function fail(op: string, message: string): never {
  console.error(`[sessions] ${op} failed:`, message);
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
): SessionStore {
  return {
    async getInterview(interviewId) {
      const { data, error } = await client
        .from("interviews")
        .select("id, questions")
        .eq("id", interviewId)
        .maybeSingle();
      if (error) fail("getInterview", error.message);
      return data;
    },

    async createSession(userId, interviewId) {
      const { data, error } = await client
        .from("interview_sessions")
        .insert({ user_id: userId, interview_id: interviewId })
        .select(SESSION_COLUMNS)
        .single();
      if (error) fail("createSession", error.message);
      return data as SessionRecord;
    },

    async getSession(sessionId) {
      const { data, error } = await client
        .from("interview_sessions")
        .select(SESSION_COLUMNS)
        .eq("id", sessionId)
        .maybeSingle();
      if (error) fail("getSession", error.message);
      return data as SessionRecord | null;
    },

    async getFeedback(sessionId) {
      const { data, error } = await client
        .from("feedback")
        .select(FEEDBACK_COLUMNS)
        .eq("session_id", sessionId)
        .maybeSingle();
      if (error) fail("getFeedback", error.message);
      return data ? toFeedback(data) : null;
    },

    async insertFeedback(row) {
      const { data, error } = await client
        .from("feedback")
        .insert({ ...row, per_answer: row.per_answer as unknown as Json })
        .select(FEEDBACK_COLUMNS)
        .single();
      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          throw new DuplicateFeedbackError(error.message);
        }
        fail("insertFeedback", error.message);
      }
      return toFeedback(data);
    },

    async completeSession(sessionId, endedAtIso) {
      const { error } = await client
        .from("interview_sessions")
        .update({ status: "completed", ended_at: endedAtIso })
        .eq("id", sessionId);
      if (error) fail("completeSession", error.message);
    },
  };
}
