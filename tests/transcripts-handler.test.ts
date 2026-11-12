import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePutTranscript, type TranscriptHandlerDeps } from "@/lib/transcripts/handlers";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import { MAX_TRANSCRIPT_BODY_BYTES } from "@/lib/transcripts/limits";
import {
  TranscriptStoreError,
  type StoreTranscriptInput,
  type StoreTranscriptOutcome,
  type TranscriptStore,
} from "@/lib/transcripts/store";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-11T12:00:00Z");

interface Row {
  user_id: string;
  status: "in_progress" | "completed" | "abandoned";
  transcript: unknown;
  transcript_source: string | null;
  duration_seconds: number | null;
  ended_reason: string | null;
  ended_at: string | null;
}

/**
 * Mirrors store_session_transcript: the check and the write happen in one
 * synchronous step after the await, the way one UPDATE ... WHERE transcript IS
 * NULL is atomic in Postgres. Two parallel callers cannot both see "null".
 */
class FakeTranscriptStore implements TranscriptStore {
  rows = new Map<string, Row>();
  calls: StoreTranscriptInput[] = [];
  fail = false;

  add(id: string, over: Partial<Row> = {}) {
    this.rows.set(id, {
      user_id: ME,
      status: "in_progress",
      transcript: null,
      transcript_source: null,
      duration_seconds: null,
      ended_reason: null,
      ended_at: null,
      ...over,
    });
  }

  async storeOnce(input: StoreTranscriptInput): Promise<StoreTranscriptOutcome> {
    this.calls.push(input);
    await Promise.resolve();
    if (this.fail) throw new TranscriptStoreError("down");
    const row = this.rows.get(input.sessionId);
    if (!row || row.user_id !== input.userId) return { kind: "not_found" };
    if (row.transcript !== null) return { kind: "already_stored" };
    const status =
      row.status === "completed"
        ? "completed"
        : input.transcript.length === 0
          ? "abandoned"
          : "completed";
    Object.assign(row, {
      transcript: input.transcript,
      transcript_source: input.metadata.source,
      duration_seconds: input.metadata.durationSeconds,
      ended_reason: input.metadata.endedReason,
      ended_at: row.ended_at ?? input.endedAtIso,
      status,
    });
    return { kind: "stored", status };
  }
}

let store: FakeTranscriptStore;
let userId: string | null;

beforeEach(() => {
  store = new FakeTranscriptStore();
  store.add(SID);
  userId = ME;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function deps(over: Partial<TranscriptHandlerDeps> = {}): TranscriptHandlerDeps {
  return {
    getUserId: async () => userId,
    store,
    adapters: defaultAdapters,
    now: () => NOW,
    ...over,
  };
}

const payload = (over: Record<string, unknown> = {}) => ({
  entries: [
    { speaker: "interviewer", text: "Tell me about indexes." },
    { speaker: "candidate", text: "They speed up reads." },
  ],
  durationSeconds: 61,
  endedReason: "user_ended",
  ...over,
});

function put(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/sessions/x/transcript", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = (p = payload()) => ({ source: "client_gemini_live", payload: p });

describe("handlePutTranscript", () => {
  it("stores the canonical transcript with source, duration and reason", async () => {
    const res = await handlePutTranscript(put(valid()), SID, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      success: true,
      session: { id: SID, status: "completed" },
      transcript: { source: "client_gemini_live", entries: 2 },
    });
    expect(store.rows.get(SID)).toMatchObject({
      status: "completed",
      transcript: [
        { role: "interviewer", text: "Tell me about indexes." },
        { role: "candidate", text: "They speed up reads." },
      ],
      transcript_source: "client_gemini_live",
      duration_seconds: 61,
      ended_reason: "user_ended",
      ended_at: new Date(NOW).toISOString(),
    });
  });

  it("marks a session with an empty transcript abandoned", async () => {
    const res = await handlePutTranscript(put(valid(payload({ entries: [] }))), SID, deps());
    expect(res.status).toBe(200);
    expect((await res.json()).session.status).toBe("abandoned");
    expect(store.rows.get(SID)).toMatchObject({ status: "abandoned", transcript: [] });
  });

  it("never moves a completed session back or to abandoned, and keeps ended_at", async () => {
    store.add(SID, { status: "completed", ended_at: "2026-11-11T09:00:00.000Z" });
    const res = await handlePutTranscript(put(valid(payload({ entries: [] }))), SID, deps());
    expect(res.status).toBe(200);
    expect(store.rows.get(SID)).toMatchObject({
      status: "completed",
      ended_at: "2026-11-11T09:00:00.000Z",
    });
  });

  it("never sets in_progress", async () => {
    for (const entries of [[], [{ speaker: "candidate", text: "a" }]]) {
      store.add(SID);
      await handlePutTranscript(put(valid(payload({ entries }))), SID, deps());
      expect(store.rows.get(SID)!.status).not.toBe("in_progress");
    }
  });

  describe("set-once", () => {
    it("returns 409 on a second write and keeps the first transcript", async () => {
      expect((await handlePutTranscript(put(valid()), SID, deps())).status).toBe(200);
      const second = payload({ entries: [{ speaker: "candidate", text: "different" }] });
      const res = await handlePutTranscript(put(valid(second)), SID, deps());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("transcript_already_stored");
      expect(store.rows.get(SID)!.transcript).toHaveLength(2);
    });

    it("lets exactly one of two parallel writes win", async () => {
      const a = payload({ entries: [{ speaker: "candidate", text: "from A" }], durationSeconds: 1 });
      const b = payload({ entries: [{ speaker: "candidate", text: "from B" }], durationSeconds: 2 });
      const [ra, rb] = await Promise.all([
        handlePutTranscript(put(valid(a)), SID, deps()),
        handlePutTranscript(put(valid(b)), SID, deps()),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
      const winner = ra.status === 200 ? "from A" : "from B";
      expect(store.rows.get(SID)!.transcript).toEqual([{ role: "candidate", text: winner }]);
    });

    it("lets exactly one of many parallel writes win", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => handlePutTranscript(put(valid()), SID, deps())),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    });

    it("treats an empty stored transcript as stored", async () => {
      await handlePutTranscript(put(valid(payload({ entries: [] }))), SID, deps());
      const res = await handlePutTranscript(put(valid()), SID, deps());
      expect(res.status).toBe(409);
    });
  });

  describe("ownership and auth", () => {
    it("requires sign-in and touches no storage", async () => {
      userId = null;
      const res = await handlePutTranscript(put(valid()), SID, deps());
      expect(res.status).toBe(401);
      expect(store.calls).toHaveLength(0);
    });

    it("answers 404 for another user's session and writes nothing", async () => {
      store.add(SID, { user_id: OTHER });
      const res = await handlePutTranscript(put(valid()), SID, deps());
      expect(res.status).toBe(404);
      expect(store.rows.get(SID)!.transcript).toBeNull();
    });

    it("answers 404 for a missing session and for a malformed id", async () => {
      expect((await handlePutTranscript(put(valid()), "99999999-9999-4999-8999-999999999999", deps())).status).toBe(404);
      store.calls.length = 0;
      const res = await handlePutTranscript(put(valid()), "not-a-uuid", deps());
      expect(res.status).toBe(404);
      expect(store.calls).toHaveLength(0);
    });

    it("always writes with the verified user id, never one from the body", async () => {
      const res = await handlePutTranscript(
        put({ ...valid(), userId: OTHER, user_id: OTHER }),
        SID,
        deps(),
      );
      expect(res.status).toBe(400);
      expect(store.calls).toHaveLength(0);

      await handlePutTranscript(put(valid()), SID, deps());
      expect(store.calls[0]).toMatchObject({ userId: ME, sessionId: SID });
    });
  });

  describe("validation and size limits", () => {
    it("rejects bad JSON, wrong content type and unknown fields before storage", async () => {
      expect((await handlePutTranscript(put("{nope"), SID, deps())).status).toBe(400);
      const wrongType = new Request("http://localhost/x", {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "{}",
      });
      expect((await handlePutTranscript(wrongType, SID, deps())).status).toBe(415);
      const res = await handlePutTranscript(put({ ...valid(), extra: 1 }), SID, deps());
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_request");
      expect(store.calls).toHaveLength(0);
    });

    it("returns 413 for an oversized body", async () => {
      const big = valid(
        payload({ entries: [{ speaker: "candidate", text: "x".repeat(MAX_TRANSCRIPT_BODY_BYTES) }] }),
      );
      const res = await handlePutTranscript(put(big), SID, deps());
      expect(res.status).toBe(413);
      expect(store.calls).toHaveLength(0);
    });

    it("returns 400 with details for too many entries and too many characters", async () => {
      const many = Array.from({ length: 201 }, () => ({ speaker: "candidate", text: "a" }));
      const r1 = await handlePutTranscript(put(valid(payload({ entries: many }))), SID, deps());
      expect(r1.status).toBe(400);
      expect(JSON.stringify((await r1.json()).details)).toContain("entries");

      const long = Array.from({ length: 4 }, () => ({ speaker: "candidate", text: "x".repeat(7_000) }));
      const r2 = await handlePutTranscript(put(valid(payload({ entries: long }))), SID, deps());
      expect(r2.status).toBe(400);
      expect(store.calls).toHaveLength(0);
    });

    it("rejects an unregistered source", async () => {
      const res = await handlePutTranscript(
        put({ source: "vapi", payload: payload() }),
        SID,
        deps(),
      );
      expect(res.status).toBe(400);
    });
  });

  it("returns a generic 500 and never logs transcript text when storage fails", async () => {
    store.fail = true;
    const secret = "SECRET-CANDIDATE-ANSWER";
    const res = await handlePutTranscript(
      put(valid(payload({ entries: [{ speaker: "candidate", text: secret }] }))),
      SID,
      deps(),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret);
  });

  it("accepts a provider registered later without handler changes", async () => {
    const calls: unknown[] = [];
    const second = {
      source: "client_gemini_live" as const,
      parse: (p: unknown) => {
        calls.push(p);
        return {
          ok: true as const,
          value: {
            transcript: [{ role: "candidate" as const, text: "from another provider" }],
            metadata: { source: "client_gemini_live" as const, durationSeconds: 3, endedReason: "error" as const },
          },
        };
      },
    };
    const res = await handlePutTranscript(
      put({ source: "client_gemini_live", payload: { anything: true } }),
      SID,
      deps({ adapters: { client_gemini_live: second } }),
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ anything: true }]);
  });
});
