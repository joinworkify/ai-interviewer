import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseSessionStore,
  DuplicateFeedbackError,
  SessionStoreError,
  type NewFeedback,
} from "@/lib/sessions/store";

import { fakeClient } from "./helpers/fake-supabase";

/**
 * The store runs on the service-role client, which bypasses RLS, so these tests
 * pin the only remaining protection: every query is filtered by the verified
 * user id. A recording fake stands in for the query builder (no network).
 */

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const IV = "33333333-3333-4333-8333-333333333333";
const SID = "44444444-4444-4444-8444-444444444444";

const SESSION_ROW = {
  id: SID,
  interview_id: IV,
  user_id: ME,
  status: "in_progress",
  started_at: "2026-11-12T00:00:00Z",
  ended_at: null,
  transcript: null,
};

function feedbackRow(over: Partial<NewFeedback> = {}): NewFeedback {
  return {
    session_id: SID,
    user_id: ME,
    total_score: 70,
    strengths: [],
    areas_for_improvement: [],
    final_assessment: "ok",
    per_answer: [],
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("session store scopes every query to the verified user", () => {
  it("getInterview filters by id and user_id", async () => {
    const { client, log } = fakeClient(() => ({ data: { id: IV, questions: ["Q"] }, error: null }));
    const store = createSupabaseSessionStore(client, async () => ME);
    await store.getInterview(IV);
    expect(log).toHaveLength(1);
    expect(log[0].filters).toEqual({ id: IV, user_id: ME });
  });

  it("getSession filters by id and user_id", async () => {
    const { client, log } = fakeClient(() => ({ data: SESSION_ROW, error: null }));
    await createSupabaseSessionStore(client, async () => ME).getSession(SID);
    expect(log[0].filters).toEqual({ id: SID, user_id: ME });
  });

  it("getFeedback filters by session_id and user_id", async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: null }));
    await createSupabaseSessionStore(client, async () => ME).getFeedback(SID);
    expect(log[0].filters).toEqual({ session_id: SID, user_id: ME });
  });

  it("completeSession updates only status and ended_at, filtered by id and user_id", async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: null }));
    await createSupabaseSessionStore(client, async () => ME).completeSession(SID, "2026-11-12T01:00:00Z");
    expect(log).toHaveLength(1);
    expect(log[0].op).toBe("update");
    expect(log[0].payload).toEqual({ status: "completed", ended_at: "2026-11-12T01:00:00Z" });
    expect(log[0].filters).toEqual({ id: SID, user_id: ME });
  });

  it("createSession checks the user owns the interview, then inserts with the verified id", async () => {
    const { client, log } = fakeClient((q) =>
      q.op === "insert"
        ? { data: SESSION_ROW, error: null }
        : { data: { id: IV }, error: null },
    );
    await createSupabaseSessionStore(client, async () => ME).createSession(ME, IV);
    expect(log.map((q) => q.op)).toEqual(["select", "insert"]);
    expect(log[0].table).toBe("interviews");
    expect(log[0].filters).toEqual({ id: IV, user_id: ME });
    expect(log[1].payload).toEqual({ user_id: ME, interview_id: IV });
  });

  it("createSession refuses an interview the user does not own and inserts nothing", async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: null }));
    await expect(
      createSupabaseSessionStore(client, async () => ME).createSession(ME, IV),
    ).rejects.toBeInstanceOf(SessionStoreError);
    expect(log.some((q) => q.op === "insert")).toBe(false);
  });

  it("insertFeedback checks session ownership first, then inserts the verified user id", async () => {
    const { client, log } = fakeClient((q) =>
      q.op === "insert"
        ? {
            data: { ...feedbackRow(), id: "f1", created_at: "2026-11-12T00:00:00Z" },
            error: null,
          }
        : { data: { id: SID }, error: null },
    );
    await createSupabaseSessionStore(client, async () => ME).insertFeedback(feedbackRow());
    expect(log.map((q) => `${q.table}:${q.op}`)).toEqual([
      "interview_sessions:select",
      "feedback:insert",
    ]);
    expect(log[0].filters).toEqual({ id: SID, user_id: ME });
    expect((log[1].payload as { user_id: string }).user_id).toBe(ME);
  });

  it("insertFeedback refuses a row for a session the user does not own", async () => {
    const { client, log } = fakeClient(() => ({ data: null, error: null }));
    await expect(
      createSupabaseSessionStore(client, async () => ME).insertFeedback(feedbackRow()),
    ).rejects.toBeInstanceOf(SessionStoreError);
    expect(log.some((q) => q.op === "insert")).toBe(false);
  });

  it("maps a unique violation to DuplicateFeedbackError", async () => {
    const { client } = fakeClient((q) =>
      q.op === "insert"
        ? { data: null, error: { message: "dup", code: "23505" } }
        : { data: { id: SID }, error: null },
    );
    await expect(
      createSupabaseSessionStore(client, async () => ME).insertFeedback(feedbackRow()),
    ).rejects.toBeInstanceOf(DuplicateFeedbackError);
  });
});

describe("session store refuses a user id that is not the verified one", () => {
  it("createSession for another user id", async () => {
    const { client, log } = fakeClient(() => ({ data: SESSION_ROW, error: null }));
    await expect(
      createSupabaseSessionStore(client, async () => ME).createSession(OTHER, IV),
    ).rejects.toBeInstanceOf(SessionStoreError);
    expect(log).toHaveLength(0);
  });

  it("insertFeedback with another user's id", async () => {
    const { client, log } = fakeClient(() => ({ data: { id: SID }, error: null }));
    await expect(
      createSupabaseSessionStore(client, async () => ME).insertFeedback(feedbackRow({ user_id: OTHER })),
    ).rejects.toBeInstanceOf(SessionStoreError);
    expect(log).toHaveLength(0);
  });

  it("any call without a verified user touches nothing", async () => {
    const { client, log } = fakeClient(() => ({ data: SESSION_ROW, error: null }));
    const store = createSupabaseSessionStore(client, async () => null);
    await expect(store.getSession(SID)).rejects.toBeInstanceOf(SessionStoreError);
    await expect(store.getInterview(IV)).rejects.toBeInstanceOf(SessionStoreError);
    await expect(store.getFeedback(SID)).rejects.toBeInstanceOf(SessionStoreError);
    await expect(store.completeSession(SID, "x")).rejects.toBeInstanceOf(SessionStoreError);
    expect(log).toHaveLength(0);
  });
});
