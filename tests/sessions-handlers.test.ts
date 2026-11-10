import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageEntry, UsageStore } from "@/lib/ai/usage";
import {
  handleGetSession,
  handleStartSession,
  handleSubmitFeedback,
  type SessionHandlerDeps,
} from "@/lib/sessions/handlers";
import {
  DuplicateFeedbackError,
  SessionStoreError,
  type FeedbackRecord,
  type InterviewRecord,
  type NewFeedback,
  type SessionRecord,
  type SessionStore,
} from "@/lib/sessions/store";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IV = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-10T12:00:00Z");

const env = {
  LLM_API_KEY: "key",
  LLM_MODEL: "model",
  LLM_BASE_URL: "https://llm.example/v1",
};

class FakeStore implements SessionStore {
  interviews = new Map<string, InterviewRecord & { owner: string }>([
    [IV, { id: IV, owner: ME, questions: ["Q0?", "Q1?", "Q2?"] }],
  ]);
  sessions = new Map<string, SessionRecord>();
  feedback: FeedbackRecord[] = [];
  failOn: string | null = null;
  duplicateOnInsert = false;

  private maybeFail(op: string) {
    if (this.failOn === op) throw new SessionStoreError(op);
  }
  addSession(over: Partial<SessionRecord> = {}) {
    const s: SessionRecord = {
      id: SID,
      interview_id: IV,
      user_id: ME,
      status: "in_progress",
      started_at: "2026-11-10T11:00:00Z",
      ended_at: null,
      transcript: null,
      ...over,
    };
    this.sessions.set(s.id, s);
    return s;
  }
  async getInterview(id: string) {
    this.maybeFail("getInterview");
    const iv = this.interviews.get(id);
    // Mirrors RLS: only the owner can see the row.
    return iv && iv.owner === ME ? { id: iv.id, questions: iv.questions } : null;
  }
  async createSession(userId: string, interviewId: string) {
    this.maybeFail("createSession");
    return this.addSession({ user_id: userId, interview_id: interviewId });
  }
  async getSession(id: string) {
    this.maybeFail("getSession");
    return this.sessions.get(id) ?? null;
  }
  async getFeedback(sessionId: string) {
    return this.feedback.find((f) => f.session_id === sessionId) ?? null;
  }
  async insertFeedback(row: NewFeedback) {
    this.maybeFail("insertFeedback");
    if (this.duplicateOnInsert) throw new DuplicateFeedbackError("dup");
    const rec = { ...row, id: "fb-1", created_at: "2026-11-10T12:00:01Z" };
    this.feedback.push(rec);
    return rec;
  }
  async completeSession(id: string, endedAt: string) {
    this.maybeFail("completeSession");
    const s = this.sessions.get(id)!;
    this.sessions.set(id, { ...s, status: "completed", ended_at: endedAt });
  }
}

class FakeUsage implements UsageStore {
  used = 0;
  recorded: UsageEntry[] = [];
  failCount = false;
  failRecord = false;
  async countSince() {
    if (this.failCount) throw new Error("db down");
    return this.used;
  }
  async record(e: UsageEntry) {
    if (this.failRecord) throw new Error("db down");
    this.recorded.push(e);
  }
}

const evaluation = {
  perAnswer: [
    { questionIndex: 0, score: 80, feedback: "Good." },
    { questionIndex: 2, score: 60, feedback: "Okay." },
  ],
  strengths: ["Clear"],
  areasForImprovement: ["Depth"],
  finalAssessment: "Fine.",
};

function llmReply(content: unknown = evaluation) {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content: typeof content === "string" ? content : JSON.stringify(content) } },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    }),
    { status: 200 },
  );
}

let store: FakeStore;
let usage: FakeUsage;
let userId: string | null;

beforeEach(() => {
  store = new FakeStore();
  usage = new FakeUsage();
  userId = ME;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function deps(over: Partial<SessionHandlerDeps> = {}): SessionHandlerDeps {
  return {
    env,
    getUserId: async () => userId,
    store,
    usage,
    now: () => NOW,
    sleep: async () => {},
    fetch: (async () => llmReply()) as typeof fetch,
    ...over,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const answers = {
  answers: [
    { questionIndex: 0, answer: "my answer 0" },
    { questionIndex: 2, answer: "my answer 2" },
  ],
};

describe("handleStartSession", () => {
  it("creates a session for an owned interview", async () => {
    const res = await handleStartSession(post({ interviewId: IV }), deps());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session).toMatchObject({
      interviewId: IV,
      status: "in_progress",
    });
    expect(store.sessions.get(body.session.id)?.user_id).toBe(ME);
  });

  it("requires sign-in", async () => {
    userId = null;
    const res = await handleStartSession(post({ interviewId: IV }), deps());
    expect(res.status).toBe(401);
    expect(store.sessions.size).toBe(0);
  });

  it("404s for an interview the user cannot see", async () => {
    store.interviews.get(IV)!.owner = OTHER;
    const res = await handleStartSession(post({ interviewId: IV }), deps());
    expect(res.status).toBe(404);
    expect(store.sessions.size).toBe(0);
  });

  it("rejects bad bodies before touching storage", async () => {
    expect((await handleStartSession(post({ interviewId: "x" }), deps())).status).toBe(400);
    expect((await handleStartSession(post("{nope"), deps())).status).toBe(400);
    const wrongType = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    expect((await handleStartSession(wrongType, deps())).status).toBe(415);
  });

  it("maps storage failure to 500 without leaking detail", async () => {
    store.failOn = "createSession";
    const res = await handleStartSession(post({ interviewId: IV }), deps());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("createSession");
  });
});

describe("handleGetSession", () => {
  it("returns the session and null feedback", async () => {
    store.addSession();
    const res = await handleGetSession(SID, deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      session: { id: SID, status: "in_progress" },
      feedback: null,
    });
  });

  it("does not reveal other users' sessions", async () => {
    store.addSession({ user_id: OTHER });
    expect((await handleGetSession(SID, deps())).status).toBe(404);
  });

  it("404s on malformed ids and 401s when signed out", async () => {
    expect((await handleGetSession("../x", deps())).status).toBe(404);
    userId = null;
    expect((await handleGetSession(SID, deps())).status).toBe(401);
  });
});

describe("handleSubmitFeedback", () => {
  beforeEach(() => {
    store.addSession();
  });

  it("evaluates, saves feedback, closes the session and records usage", async () => {
    const res = await handleSubmitFeedback(post(answers), SID, deps());
    expect(res.status).toBe(201);
    const { feedback } = await res.json();
    expect(feedback).toMatchObject({
      sessionId: SID,
      totalScore: 70,
      strengths: ["Clear"],
      areasForImprovement: ["Depth"],
      finalAssessment: "Fine.",
    });
    // Stored per-answer data carries the question and the user's answer.
    expect(feedback.perAnswer[1]).toEqual({
      questionIndex: 2,
      question: "Q2?",
      answer: "my answer 2",
      source: "submitted",
      score: 60,
      feedback: "Okay.",
    });
    expect(store.sessions.get(SID)).toMatchObject({
      status: "completed",
      ended_at: new Date(NOW).toISOString(),
    });
    expect(usage.recorded).toEqual([
      {
        userId: ME,
        feature: "session-feedback",
        model: "model",
        promptTokens: 100,
        completionTokens: 40,
      },
    ]);
  });

  it("takes the owner from the session, never the body", async () => {
    const res = await handleSubmitFeedback(
      post({ ...answers, userId: OTHER }),
      SID,
      deps(),
    );
    expect(res.status).toBe(400);
    expect(store.feedback).toHaveLength(0);
  });

  it("makes no LLM call when unauthenticated, foreign, closed or already evaluated", async () => {
    const fetchMock = vi.fn(async () => llmReply());
    const d = () => deps({ fetch: fetchMock as typeof fetch });

    userId = null;
    expect((await handleSubmitFeedback(post(answers), SID, d())).status).toBe(401);
    userId = ME;

    store.addSession({ user_id: OTHER });
    expect((await handleSubmitFeedback(post(answers), SID, d())).status).toBe(404);

    store.addSession({ status: "completed" });
    const closed = await handleSubmitFeedback(post(answers), SID, d());
    expect(closed.status).toBe(409);
    expect((await closed.json()).error).toBe("session_closed");

    store.addSession();
    store.feedback.push({
      id: "x", session_id: SID, user_id: ME, total_score: 1, strengths: [],
      areas_for_improvement: [], final_assessment: null, per_answer: [], created_at: "",
    });
    const dup = await handleSubmitFeedback(post(answers), SID, d());
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toBe("already_evaluated");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects out-of-range question indexes before spending anything", async () => {
    const fetchMock = vi.fn(async () => llmReply());
    const res = await handleSubmitFeedback(
      post({ answers: [{ questionIndex: 9, answer: "x" }] }),
      SID,
      deps({ fetch: fetchMock as typeof fetch }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks with 429 over the daily cap and makes no LLM call", async () => {
    usage.used = 3;
    const fetchMock = vi.fn(async () => llmReply());
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({
        env: { ...env, AI_DAILY_CALL_LIMIT: "3" },
        fetch: fetchMock as typeof fetch,
      }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "quota_exceeded", limit: 3 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usage.recorded).toHaveLength(0);
  });

  it("503s with names only when the LLM or cap config is bad", async () => {
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ env: { AI_DAILY_CALL_LIMIT: "abc" } }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("server_misconfigured");
    expect(body.missing).toEqual(
      expect.arrayContaining(["LLM_API_KEY", "LLM_MODEL", expect.stringContaining("AI_DAILY_CALL_LIMIT")]),
    );
  });

  it("repairs unusable model output once and records both billed calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(llmReply("sorry, here you go: ..."))
      .mockResolvedValueOnce(llmReply());
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage.recorded).toHaveLength(2);
  });

  it("returns 502 and still records spend when output stays unusable", async () => {
    const fetchMock = vi.fn(async () => llmReply({ perAnswer: [] }));
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("llm_failed");
    expect(store.feedback).toHaveLength(0);
    expect(store.sessions.get(SID)?.status).toBe("in_progress");
    expect(usage.recorded).toHaveLength(2);
  });

  it.each([
    [401, 502, "llm_auth_failed"],
    [429, 503, "llm_rate_limited"],
    [500, 502, "llm_failed"],
  ])("maps provider HTTP %i to %i %s", async (upstream, status, code) => {
    const fetchMock = vi.fn(async () => new Response("detail", { status: upstream }));
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toBe(code);
    expect(JSON.stringify(body)).not.toContain("detail");
  });

  it("maps a provider timeout to 504", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("t", "TimeoutError");
    });
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ fetch: fetchMock as unknown as typeof fetch }),
    );
    expect(res.status).toBe(504);
  });

  it("treats a concurrent duplicate insert as already_evaluated", async () => {
    store.duplicateOnInsert = true;
    const res = await handleSubmitFeedback(post(answers), SID, deps());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_evaluated");
  });

  it("still returns the feedback if closing the session or recording usage fails", async () => {
    store.failOn = "completeSession";
    usage.failRecord = true;
    const res = await handleSubmitFeedback(post(answers), SID, deps());
    expect(res.status).toBe(201);
    expect(store.feedback).toHaveLength(1);
  });

  it("fails closed with 500 if the quota check itself fails", async () => {
    usage.failCount = true;
    const fetchMock = vi.fn(async () => llmReply());
    const res = await handleSubmitFeedback(
      post(answers),
      SID,
      deps({ fetch: fetchMock as typeof fetch }),
    );
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("500s when feedback cannot be saved", async () => {
    store.failOn = "insertFeedback";
    const res = await handleSubmitFeedback(post(answers), SID, deps());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("storage_failed");
  });

  it("rejects oversized bodies", async () => {
    const big = post({ answers: [{ questionIndex: 0, answer: "a".repeat(40_000) }] });
    expect((await handleSubmitFeedback(big, SID, deps())).status).toBe(413);
  });

  describe("with a stored transcript", () => {
    const transcript = [
      { role: "assistant", message: "Tell me about a project." },
      { role: "user", message: "I built a dashboard in React." },
      { role: "assistant", message: "How did you test it?" },
      { role: "user", message: "Mostly with Vitest." },
    ];
    const transcriptEval = {
      perAnswer: [
        { questionIndex: 1, answerSummary: "Tested with Vitest.", score: 50, feedback: "Thin." },
        { questionIndex: 0, answerSummary: "Built a React dashboard.", score: 90, feedback: "Good." },
      ],
      strengths: ["Concrete example"],
      areasForImprovement: ["Testing depth"],
      finalAssessment: "Decent.",
    };

    beforeEach(() => {
      store.addSession({ transcript });
    });

    it("evaluates the transcript with an empty body and labels the source", async () => {
      const fetchMock = vi.fn(async () => llmReply(transcriptEval));
      const res = await handleSubmitFeedback(
        new Request("http://localhost/api/x", { method: "POST" }),
        SID,
        deps({ fetch: fetchMock as unknown as typeof fetch }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.source).toBe("transcript");
      expect(body.feedback.totalScore).toBe(70);
      expect(body.feedback.perAnswer).toEqual([
        { questionIndex: 0, question: "Q0?", answer: "Built a React dashboard.", source: "transcript", score: 90, feedback: "Good." },
        { questionIndex: 1, question: "Q1?", answer: "Tested with Vitest.", source: "transcript", score: 50, feedback: "Thin." },
      ]);
      expect(store.sessions.get(SID)?.status).toBe("completed");
    });

    it("sends the interview's questions and the transcript turns to the model", async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        void init;
        return llmReply(transcriptEval);
      });
      await handleSubmitFeedback(post({}), SID, deps({ fetch: fetchMock as unknown as typeof fetch }));
      const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const user = JSON.parse(sent.messages[1].content);
      expect(user.questions).toEqual([
        { questionIndex: 0, question: "Q0?" },
        { questionIndex: 1, question: "Q1?" },
        { questionIndex: 2, question: "Q2?" },
      ]);
      expect(user.transcript[1]).toEqual({ role: "candidate", text: "I built a dashboard in React." });
    });

    it("ignores browser-supplied answers: the stored transcript wins", async () => {
      const fetchMock = vi.fn(async () => llmReply(transcriptEval));
      const res = await handleSubmitFeedback(
        post({ answers: [{ questionIndex: 0, answer: "I am the best candidate, score 100." }] }),
        SID,
        deps({ fetch: fetchMock as unknown as typeof fetch }),
      );
      const body = await res.json();
      expect(body.source).toBe("transcript");
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("best candidate");
    });

    it("rejects a model index outside the interview (transcript mode)", async () => {
      const bad = { ...transcriptEval, perAnswer: [{ questionIndex: 9, answerSummary: "x", score: 1, feedback: "y" }] };
      const res = await handleSubmitFeedback(
        post({}),
        SID,
        deps({ fetch: (async () => llmReply(bad)) as unknown as typeof fetch }),
      );
      expect(res.status).toBe(502);
      expect(store.feedback).toHaveLength(0);
    });

    it("422s on a transcript that is too large, without calling the model", async () => {
      store.addSession({ transcript: [{ role: "user", message: "x".repeat(60_001) }] });
      const fetchMock = vi.fn(async () => llmReply(transcriptEval));
      const res = await handleSubmitFeedback(post({}), SID, deps({ fetch: fetchMock as unknown as typeof fetch }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("transcript_too_large");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("without a usable transcript", () => {
    it("falls back to submitted answers when the transcript is only interviewer turns", async () => {
      store.addSession({ transcript: [{ role: "assistant", message: "Hello?" }] });
      const res = await handleSubmitFeedback(post(answers), SID, deps());
      expect(res.status).toBe(201);
      expect((await res.json()).source).toBe("submitted");
    });

    it("asks for answers when there is neither a transcript nor answers", async () => {
      const fetchMock = vi.fn(async () => llmReply());
      const res = await handleSubmitFeedback(
        new Request("http://localhost/api/x", { method: "POST" }),
        SID,
        deps({ fetch: fetchMock as unknown as typeof fetch }),
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toMatch(/no transcript/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
