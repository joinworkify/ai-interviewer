import {
  readLlmConfig,
  LlmError,
  type ChatMessage,
  type TokenUsage,
} from "@/lib/ai/client";
import { chatJson } from "@/lib/ai/json";
import { describeLlmError } from "@/lib/ai/errors";
import {
  buildEvaluateAnswersMessages,
  parseSessionEvaluation,
  type AnswerToEvaluate,
} from "@/lib/ai/prompts/evaluate-answers";
import {
  buildEvaluateTranscriptMessages,
  parseTranscriptEvaluation,
} from "@/lib/ai/prompts/evaluate-transcript";
import {
  checkQuota,
  readDailyCallLimit,
  type UsageStore,
} from "@/lib/ai/usage";
import { jsonResponse, readJsonBody } from "@/lib/http/json";

import {
  DuplicateFeedbackError,
  type FeedbackRecord,
  type PerAnswerRecord,
  type SessionRecord,
  type SessionStore,
} from "./store";
import { normalizeTranscript, type TranscriptTurn } from "./transcript";
import {
  isUuid,
  validateFeedbackBody,
  validateStartSessionBody,
} from "./validation";

/**
 * Handlers for the authenticated session endpoints. Framework-agnostic
 * (Request -> Response) with injectable dependencies so they can be unit
 * tested without network or a database.
 *
 * Check order for feedback is intentional and cheap-to-expensive:
 *   auth -> body -> ownership/state -> quota -> config -> LLM -> persist
 */

export const MAX_SESSION_BODY_BYTES = 32 * 1024;
export const FEEDBACK_FEATURE = "session-feedback";

export interface SessionHandlerDeps {
  env: Record<string, string | undefined>;
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: SessionStore;
  usage: UsageStore;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "session_closed"
  | "already_evaluated"
  | "quota_exceeded"
  | "transcript_too_large"
  | "server_misconfigured"
  | "storage_failed"
  | "llm_auth_failed"
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_failed";

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

const unauthorized = () =>
  fail(401, "unauthorized", "Sign in to use interview sessions.");
const notFound = () => fail(404, "not_found", "Session or interview not found.");
const storageFailed = () =>
  fail(500, "storage_failed", "Could not access interview storage.");

function sessionJson(s: SessionRecord) {
  return {
    id: s.id,
    interviewId: s.interview_id,
    status: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
  };
}

function feedbackJson(f: FeedbackRecord) {
  return {
    id: f.id,
    sessionId: f.session_id,
    totalScore: f.total_score,
    strengths: f.strengths,
    areasForImprovement: f.areas_for_improvement,
    finalAssessment: f.final_assessment,
    perAnswer: f.per_answer,
    createdAt: f.created_at,
  };
}

/** POST /api/sessions  { interviewId } */
export async function handleStartSession(
  request: Request,
  deps: SessionHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();

  const body = await readJsonBody(request, MAX_SESSION_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);

  const parsed = validateStartSessionBody(body.value);
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Invalid request.", {
      details: parsed.errors,
    });
  }

  try {
    const interview = await deps.store.getInterview(parsed.data.interviewId);
    if (!interview) return notFound();
    const session = await deps.store.createSession(userId, interview.id);
    return jsonResponse(201, { success: true, session: sessionJson(session) });
  } catch {
    return storageFailed();
  }
}

/** GET /api/sessions/:id */
export async function handleGetSession(
  sessionId: string,
  deps: SessionHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();
  if (!isUuid(sessionId)) return notFound();

  try {
    const session = await deps.store.getSession(sessionId);
    if (!session || session.user_id !== userId) return notFound();
    const feedback = await deps.store.getFeedback(session.id);
    return jsonResponse(200, {
      success: true,
      session: sessionJson(session),
      feedback: feedback ? feedbackJson(feedback) : null,
    });
  } catch {
    return storageFailed();
  }
}

/** What gets evaluated, and how to read the model's reply. */
interface EvaluationPlan {
  source: "transcript" | "submitted";
  messages: ChatMessage[];
  parse: (value: unknown) => {
    totalScore: number;
    strengths: string[];
    areasForImprovement: string[];
    finalAssessment: string;
    perAnswer: PerAnswerRecord[];
  };
}

function planFromTranscript(
  questions: string[],
  turns: TranscriptTurn[],
): EvaluationPlan {
  const asked = questions.map((question, questionIndex) => ({
    questionIndex,
    question,
  }));
  return {
    source: "transcript",
    messages: buildEvaluateTranscriptMessages(asked, turns),
    parse: (value) => {
      const ev = parseTranscriptEvaluation(value, questions.length);
      return {
        ...ev,
        perAnswer: ev.perAnswer.map((e) => ({
          questionIndex: e.questionIndex,
          question: questions[e.questionIndex],
          answer: e.answerSummary,
          source: "transcript" as const,
          score: e.score,
          feedback: e.feedback,
        })),
      };
    },
  };
}

function planFromAnswers(items: AnswerToEvaluate[]): EvaluationPlan {
  const byIndex = new Map(items.map((i) => [i.questionIndex, i]));
  return {
    source: "submitted",
    messages: buildEvaluateAnswersMessages(items),
    parse: (value) => {
      const ev = parseSessionEvaluation(value, items);
      return {
        ...ev,
        perAnswer: ev.perAnswer.map((e) => ({
          questionIndex: e.questionIndex,
          question: byIndex.get(e.questionIndex)!.question,
          answer: byIndex.get(e.questionIndex)!.answer,
          source: "submitted" as const,
          score: e.score,
          feedback: e.feedback,
        })),
      };
    },
  };
}

/**
 * POST /api/sessions/:id/feedback
 *
 * Evaluates the session's stored transcript (`interview_sessions.transcript`,
 * filled by the Vapi call) when there is one. Otherwise falls back to
 * `{ answers: [{ questionIndex, answer }] }` from the request body. A stored
 * transcript always wins: the browser cannot replace what was actually said.
 * The body may be empty when a transcript exists.
 */
export async function handleSubmitFeedback(
  request: Request,
  sessionId: string,
  deps: SessionHandlerDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  const userId = await deps.getUserId();
  if (!userId) return unauthorized();
  if (!isUuid(sessionId)) return notFound();

  const body = await readJsonBody(request, MAX_SESSION_BODY_BYTES, {
    allowEmpty: true,
  });
  if (!body.ok) return fail(body.status, body.error, body.message);

  const parsed = validateFeedbackBody(body.value, { required: false });
  if (!parsed.ok) {
    return fail(400, "invalid_request", "Invalid answers.", {
      details: parsed.errors,
    });
  }

  // Ownership and state, before any paid work.
  let session: SessionRecord | null;
  let questions: string[];
  try {
    session = await deps.store.getSession(sessionId);
    if (!session || session.user_id !== userId) return notFound();
    // A completed session that holds a stored transcript still awaits feedback.
    const closed =
      session.status === "abandoned" ||
      (session.status === "completed" && session.transcript == null);
    if (closed) {
      return fail(409, "session_closed", "This session is already closed.");
    }
    if (await deps.store.getFeedback(session.id)) {
      return fail(409, "already_evaluated", "This session already has feedback.");
    }
    const interview = await deps.store.getInterview(session.interview_id);
    if (!interview) return notFound();
    questions = interview.questions;
  } catch {
    return storageFailed();
  }

  // Choose the input: stored transcript first, submitted answers second.
  let plan: EvaluationPlan;
  const transcript = normalizeTranscript(session.transcript);
  if (transcript.ok) {
    plan = planFromTranscript(questions, transcript.turns);
  } else if (transcript.reason === "too_large") {
    return fail(
      422,
      "transcript_too_large",
      "The stored transcript is too long to evaluate.",
    );
  } else {
    if (parsed.data.answers.length === 0) {
      return fail(
        400,
        "invalid_request",
        "This session has no transcript yet. Send { answers: [{ questionIndex, answer }] }.",
      );
    }
    const items: AnswerToEvaluate[] = [];
    const outOfRange: string[] = [];
    for (const a of parsed.data.answers) {
      const question = questions[a.questionIndex];
      if (question === undefined) {
        outOfRange.push(`questionIndex ${a.questionIndex} is out of range.`);
      } else {
        items.push({ questionIndex: a.questionIndex, question, answer: a.answer });
      }
    }
    if (outOfRange.length > 0) {
      return fail(400, "invalid_request", "Invalid answers.", {
        details: outOfRange,
      });
    }
    items.sort((x, y) => x.questionIndex - y.questionIndex);
    plan = planFromAnswers(items);
  }

  // Server configuration and spend guard.
  const llm = readLlmConfig(deps.env);
  const limit = readDailyCallLimit(deps.env);
  if (!llm.ok || !limit.ok) {
    const missing = [
      ...(llm.ok ? [] : [...llm.missing, ...llm.invalid]),
      ...(limit.ok ? [] : [limit.invalid]),
    ];
    console.error(`[sessions] missing/invalid server config: ${missing.join(", ")}`);
    return fail(
      503,
      "server_misconfigured",
      "AI feedback is not configured on the server.",
      { missing },
    );
  }

  try {
    const quota = await checkQuota(deps.usage, userId, limit.limit, now());
    if (!quota.allowed) {
      return fail(
        429,
        "quota_exceeded",
        "You have reached today's AI usage limit. Please try again tomorrow.",
        { limit: quota.limit },
      );
    }
  } catch (err) {
    console.error("[sessions] quota check failed", err);
    return storageFailed();
  }

  // The model call. Every call that returned a response is recorded, also
  // when its output is rejected, because it was still billed.
  const spent: { usage: TokenUsage; model: string }[] = [];
  let evaluation;
  try {
    const result = await chatJson(llm.config, plan.messages, plan.parse, {
      fetch: deps.fetch,
      sleep: deps.sleep,
      retries: 1,
      repairAttempts: 1,
      logTag: FEEDBACK_FEATURE,
      onUsage: (usage, model) => spent.push({ usage, model }),
    });
    evaluation = result.data;
  } catch (err) {
    await recordUsage(deps.usage, userId, spent);
    if (err instanceof LlmError) {
      console.error(`[sessions] LLM ${err.kind}: ${err.message}`);
      const d = describeLlmError(err);
      return fail(d.status, d.code, d.message);
    }
    console.error("[sessions] unexpected LLM error", err);
    return fail(502, "llm_failed", "The AI provider failed.");
  }
  await recordUsage(deps.usage, userId, spent);

  // Persist. The unique index on feedback(session_id) makes a concurrent
  // double-submit fail here instead of creating two rows.
  try {
    const feedback = await deps.store.insertFeedback({
      session_id: session.id,
      user_id: userId,
      total_score: evaluation.totalScore,
      strengths: evaluation.strengths,
      areas_for_improvement: evaluation.areasForImprovement,
      final_assessment: evaluation.finalAssessment,
      per_answer: evaluation.perAnswer,
    });
    // Feedback is already saved; closing the session is best effort so a
    // transient failure here does not hide a result the user paid for.
    try {
      // Already-completed sessions keep the ended_at the transcript write set.
      if (session.status === "in_progress") {
        await deps.store.completeSession(session.id, new Date(now()).toISOString());
      }
    } catch (err) {
      console.error("[sessions] could not mark session completed", err);
    }
    return jsonResponse(201, {
      success: true,
      source: plan.source,
      transcriptSource: plan.source === "transcript" ? (session.transcript_source ?? null) : null,
      feedback: feedbackJson(feedback),
    });
  } catch (err) {
    if (err instanceof DuplicateFeedbackError) {
      return fail(409, "already_evaluated", "This session already has feedback.");
    }
    return fail(500, "storage_failed", "Could not save the feedback.");
  }
}

/** Best effort: a failed usage write must not discard feedback already paid for. */
async function recordUsage(
  store: UsageStore,
  userId: string,
  spent: { usage: TokenUsage; model: string }[],
): Promise<void> {
  const results = await Promise.allSettled(
    spent.map((s) =>
      store.record({
        userId,
        feature: FEEDBACK_FEATURE,
        model: s.model,
        promptTokens: s.usage.promptTokens,
        completionTokens: s.usage.completionTokens,
      }),
    ),
  );
  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[sessions] failed to record AI usage", r.reason);
    }
  }
}
