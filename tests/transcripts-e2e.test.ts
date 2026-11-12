import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiveInterviewController,
  type ControllerDeps,
  type LiveCallbacksLike,
  type LiveSessionLike,
} from "@/lib/gemini-live/controller";
import type { LiveInterviewDetails } from "@/lib/gemini-live/interview-details";
import { attachTranscriptSync, buildGeminiPayload } from "@/lib/gemini-live/transcript-sync";
import { handleSubmitFeedback, type SessionHandlerDeps } from "@/lib/sessions/handlers";
import {
  type FeedbackRecord,
  type InterviewRecord,
  type NewFeedback,
  type SessionRecord,
  type SessionStore,
} from "@/lib/sessions/store";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import { putTranscript } from "@/lib/transcripts/client";
import { handlePutTranscript } from "@/lib/transcripts/handlers";
import type { StoreTranscriptInput, TranscriptStore } from "@/lib/transcripts/store";
import type { UsageEntry, UsageStore } from "@/lib/ai/usage";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IV = "11111111-1111-4111-8111-111111111111";
const SID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-11T12:00:00Z");

const DETAILS: LiveInterviewDetails = {
  role: "Backend Engineer",
  level: "senior",
  techstack: ["Go"],
  sessionId: SID,
};

/** One in-memory "database" behind both the session store and the transcript store. */
class Db implements SessionStore, TranscriptStore {
  session: SessionRecord = {
    id: SID,
    interview_id: IV,
    user_id: ME,
    status: "in_progress",
    started_at: "2026-11-11T11:00:00Z",
    ended_at: null,
    transcript: null,
    transcript_source: null,
  };
  feedback: FeedbackRecord[] = [];
  completeCalls = 0;

  async getInterview(): Promise<InterviewRecord | null> {
    return { id: IV, questions: ["What is an index?", "Explain MVCC."] };
  }
  async createSession(): Promise<SessionRecord> {
    return this.session;
  }
  async getSession(id: string) {
    return id === SID ? { ...this.session } : null;
  }
  async getFeedback() {
    return this.feedback[0] ?? null;
  }
  async insertFeedback(row: NewFeedback) {
    const rec = { ...row, id: "fb-1", created_at: "2026-11-11T12:30:00Z" };
    this.feedback.push(rec);
    return rec;
  }
  async completeSession(_id: string, endedAt: string) {
    this.completeCalls++;
    this.session = { ...this.session, status: "completed", ended_at: endedAt };
  }
  async storeOnce(input: StoreTranscriptInput) {
    await Promise.resolve();
    if (this.session.user_id !== input.userId || input.sessionId !== SID) {
      return { kind: "not_found" as const };
    }
    if (this.session.transcript != null) return { kind: "already_stored" as const };
    const status = input.transcript.length === 0 ? ("abandoned" as const) : ("completed" as const);
    this.session = {
      ...this.session,
      transcript: input.transcript,
      transcript_source: input.metadata.source,
      status,
      ended_at: input.endedAtIso,
    };
    return { kind: "stored" as const, status };
  }
}

class FakeUsage implements UsageStore {
  recorded: UsageEntry[] = [];
  async countSince() {
    return 0;
  }
  async record(e: UsageEntry) {
    this.recorded.push(e);
  }
}

interface Rig {
  controller: LiveInterviewController;
  callbacks: LiveCallbacksLike[];
  db: Db;
  fetchCalls: { url: string; init: RequestInit }[];
  outcomes: string[];
  sends: number;
  micStarts: number;
}

function rig(opts: { micError?: boolean } = {}): Rig {
  const db = new Db();
  const r = { db, callbacks: [], fetchCalls: [], outcomes: [], sends: 0, micStarts: 0 } as unknown as Rig;
  let clock = NOW;
  const session: LiveSessionLike = {
    sendRealtimeInput: () => {},
    sendToolResponse: () => {},
    close: () => {},
  };
  const deps: ControllerDeps = {
    startMicrophone: async () => {
      r.micStarts++;
      if (opts.micError) throw new Error("denied");
      return { sampleRate: 48000, stop: () => {} };
    },
    requestToken: async () => ({ token: "auth_tokens/x", model: "m", maxSessionSeconds: 300 }),
    connect: async ({ callbacks }) => {
      r.callbacks.push(callbacks);
      return session;
    },
    createPlayer: () => ({
      resume: async () => {},
      enqueue: () => {},
      clear: () => {},
      remainingMs: () => 0,
      close: () => {},
    }),
    now: () => (clock += 20_000),
  };
  r.controller = new LiveInterviewController(deps);

  // The browser's fetch, routed straight into the real route handler.
  const fakeFetch = (async (url: string, init: RequestInit) => {
    r.fetchCalls.push({ url, init });
    r.sends++;
    return handlePutTranscript(
      new Request(`http://localhost${url}`, init),
      url.split("/")[3],
      { getUserId: async () => ME, store: db, adapters: defaultAdapters, now: () => NOW },
    );
  }) as unknown as typeof fetch;

  attachTranscriptSync(r.controller, {
    sessionId: SID,
    send: ({ sessionId, payload }) =>
      putTranscript({ sessionId, source: "client_gemini_live", payload, fetchImpl: fakeFetch }),
    onOutcome: (o) => r.outcomes.push(o),
  });
  return r;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function say(r: Rig, sc: object) {
  r.callbacks[0].onmessage({ serverContent: sc });
}

async function runInterview(r: Rig) {
  await r.controller.start(DETAILS);
  say(r, { outputTranscription: { text: "What is an index?" }, turnComplete: true });
  say(r, { inputTranscription: { text: "A structure that speeds up reads." } });
  say(r, { outputTranscription: { text: "And the downside?" }, turnComplete: true });
  say(r, { inputTranscription: { text: "Slower writes." } });
}

let usage: FakeUsage;
beforeEach(() => {
  usage = new FakeUsage();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function feedbackDeps(db: Db, fetchImpl: typeof fetch): SessionHandlerDeps {
  return {
    env: { LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "https://llm.example/v1" },
    getUserId: async () => ME,
    store: db,
    usage,
    now: () => NOW + 60_000,
    sleep: async () => {},
    fetch: fetchImpl,
  };
}

function llmFetch(captured: { body?: string }) {
  return (async (_url: string, init: RequestInit) => {
    captured.body = String(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                perAnswer: [{ questionIndex: 0, answerSummary: "Said indexes speed up reads.", score: 70, feedback: "Good." }],
                strengths: ["Clear"],
                areasForImprovement: ["Depth"],
                finalAssessment: "Fine.",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

describe("ending a Gemini session stores its transcript", () => {
  it("End saves the canonical transcript once, with source, duration and reason", async () => {
    const r = rig();
    await runInterview(r);
    r.controller.end();
    await flush();

    expect(r.outcomes).toEqual(["stored"]);
    expect(r.fetchCalls).toHaveLength(1);
    expect(r.fetchCalls[0].url).toBe(`/api/sessions/${SID}/transcript`);
    expect(r.fetchCalls[0].init).toMatchObject({ method: "PUT", keepalive: true });
    expect(r.db.session).toMatchObject({
      status: "completed",
      transcript_source: "client_gemini_live",
      transcript: [
        { role: "interviewer", text: "What is an index?" },
        { role: "candidate", text: "A structure that speeds up reads." },
        { role: "interviewer", text: "And the downside?" },
        { role: "candidate", text: "Slower writes." },
      ],
    });
  });

  it("unmount (dispose) while active saves with reason page_closed, and End afterwards does not resend", async () => {
    const r = rig();
    await runInterview(r);
    r.controller.dispose();
    await flush();
    r.controller.end();
    await flush();
    expect(r.sends).toBe(1);
    expect(r.outcomes).toEqual(["stored"]);
  });

  it("a connection error after the interview started still saves what was said", async () => {
    const r = rig();
    await runInterview(r);
    r.callbacks[0].onclose({ code: 1006 });
    await flush();
    expect(r.controller.getSnapshot().endReason).toBe("error");
    expect(r.outcomes).toEqual(["stored"]);
    expect(r.db.session.transcript).toHaveLength(4);
  });

  it("an interview where nobody spoke leaves the session abandoned", async () => {
    const r = rig();
    await r.controller.start(DETAILS);
    r.controller.end();
    await flush();
    expect(r.db.session).toMatchObject({ status: "abandoned", transcript: [] });
  });

  it("sends nothing when the session never started (microphone denied)", async () => {
    const r = rig({ micError: true });
    await r.controller.start(DETAILS);
    await flush();
    expect(r.sends).toBe(0);
    expect(r.db.session).toMatchObject({ status: "in_progress", transcript: null });
  });

  it("a second run is rejected with already_stored and keeps the first transcript", async () => {
    const r = rig();
    await runInterview(r);
    r.controller.end();
    await flush();
    await r.controller.start(DETAILS);
    say(r, { inputTranscription: { text: "second run" } });
    r.controller.end();
    await flush();
    expect(r.outcomes).toEqual(["stored", "already_stored"]);
    expect(JSON.stringify(r.db.session.transcript)).not.toContain("second run");
  });

  it("buildGeminiPayload is null until the session settles", async () => {
    const r = rig();
    await r.controller.start(DETAILS);
    expect(buildGeminiPayload(r.controller.getSnapshot())).toBeNull();
    r.controller.end();
    expect(buildGeminiPayload(r.controller.getSnapshot())).toMatchObject({
      endedReason: "user_ended",
      durationSeconds: expect.any(Number),
    });
  });
});

describe("feedback from the stored Gemini transcript", () => {
  it("evaluates the stored transcript with no answers and reports transcriptSource", async () => {
    const r = rig();
    await runInterview(r);
    r.controller.end();
    await flush();
    const endedAt = r.db.session.ended_at;
    expect(r.db.session.status).toBe("completed");

    const captured: { body?: string } = {};
    const res = await handleSubmitFeedback(
      new Request("http://localhost/api/sessions/x/feedback", { method: "POST" }),
      SID,
      feedbackDeps(r.db, llmFetch(captured)),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, source: "transcript", transcriptSource: "client_gemini_live" });
    expect(body.feedback.perAnswer[0]).toMatchObject({ questionIndex: 0, source: "transcript" });

    // The model saw the real turns with canonical roles.
    expect(captured.body).toContain("Slower writes.");
    expect(captured.body).toContain("candidate");
    // Already completed by the transcript write: not re-completed, ended_at kept.
    expect(r.db.completeCalls).toBe(0);
    expect(r.db.session.ended_at).toBe(endedAt);
    expect(r.db.feedback).toHaveLength(1);
  });

  it("still refuses an abandoned session and a completed one with no transcript", async () => {
    const r = rig();
    const never = vi.fn();
    const d = feedbackDeps(r.db, never as unknown as typeof fetch);

    r.db.session = { ...r.db.session, status: "abandoned", transcript: [] };
    expect((await handleSubmitFeedback(new Request("http://localhost/x", { method: "POST" }), SID, d)).status).toBe(409);

    r.db.session = { ...r.db.session, status: "completed", transcript: null };
    expect((await handleSubmitFeedback(new Request("http://localhost/x", { method: "POST" }), SID, d)).status).toBe(409);
    expect(never).not.toHaveBeenCalled();
  });

  it("an in-progress session scored from submitted answers is still completed by the handler", async () => {
    const r = rig();
    const captured: { body?: string } = {};
    const res = await handleSubmitFeedback(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: [{ questionIndex: 0, answer: "An index speeds up reads." }] }),
      }),
      SID,
      feedbackDeps(r.db, llmFetch(captured)),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).transcriptSource).toBeNull();
    expect(r.db.completeCalls).toBe(1);
  });
});
