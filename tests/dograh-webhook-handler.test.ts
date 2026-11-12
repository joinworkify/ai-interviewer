import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDograhWebhook, type DograhWebhookDeps } from "@/lib/dograh/webhook-handler";
import { defaultAdapters } from "@/lib/transcripts/adapters";
import type { StoreTranscriptInput, TranscriptStore } from "@/lib/transcripts/store";

import {
  ENV,
  OTHER_USER,
  SESSION,
  SESSION_SECRET,
  TRANSCRIPT_TEXT,
  TRANSCRIPT_URL,
  USER,
  WEBHOOK_SECRET,
  makeToken,
} from "./helpers/dograh";

const NOW = Date.UTC(2026, 10, 12, 10, 5, 0);

function body(over: Record<string, unknown> = {}) {
  return {
    workflow_run_id: 7,
    call_time: "2026-11-12T10:00:00+00:00",
    duration_seconds: 42.4,
    call_disposition: "user_hangup",
    session_token: makeToken({ nowMs: NOW - 60_000 }),
    transcript_url: TRANSCRIPT_URL,
    ...over,
  };
}

interface Harness {
  deps: DograhWebhookDeps;
  store: { storeOnce: ReturnType<typeof vi.fn> };
  fetchImpl: ReturnType<typeof vi.fn>;
}

function harness(over: Partial<DograhWebhookDeps> = {}, storeResult: unknown = { kind: "stored", status: "completed" }): Harness {
  const store = {
    storeOnce: vi.fn<(input: StoreTranscriptInput) => Promise<unknown>>(async () => storeResult),
  };
  const fetchImpl = vi.fn(async () => new Response(TRANSCRIPT_TEXT));
  return {
    store,
    fetchImpl,
    deps: {
      env: ENV,
      store: store as unknown as TranscriptStore,
      adapters: defaultAdapters,
      fetchImpl: fetchImpl as never,
      now: () => NOW,
      ...over,
    },
  };
}

function post(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/dograh/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WEBHOOK_SECRET}`,
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

let logged: string;
beforeEach(() => {
  logged = "";
  for (const m of ["error", "warn", "log"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged += args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("handleDograhWebhook: authentication", () => {
  it("answers 503 without naming anything when the webhook secret is not set", async () => {
    const { deps, store } = harness({ env: {} });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("DOGRAH_");
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", {}],
    ["wrong secret", { authorization: "Bearer wrong-secret-0123456789-abcdefghijklmnopqr" }],
    ["a prefix of the secret", { authorization: `Bearer ${WEBHOOK_SECRET.slice(0, 20)}` }],
    ["the wrong scheme", { authorization: `Basic ${WEBHOOK_SECRET}` }],
    ["a lowercase scheme", { authorization: `bearer ${WEBHOOK_SECRET}` }],
    ["extra tokens", { authorization: `Bearer ${WEBHOOK_SECRET} extra` }],
  ])("answers 401 for %s and does no work", async (_name, headers) => {
    const { deps, store, fetchImpl } = harness();
    const req = new Request("http://localhost:3000/api/dograh/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body()),
    });
    const res = await handleDograhWebhook(req, deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("does not use the session signing secret as a Bearer secret", async () => {
    const { deps } = harness();
    const res = await handleDograhWebhook(post(body(), { authorization: `Bearer ${SESSION_SECRET}` }), deps);
    expect(res.status).toBe(401);
  });

  it("names missing configuration only after the caller is authenticated", async () => {
    const { deps } = harness({ env: { DOGRAH_WEBHOOK_SECRET: WEBHOOK_SECRET } });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual(["DOGRAH_API_URL", "DOGRAH_SESSION_SIGNING_SECRET"]);
  });
});

describe("handleDograhWebhook: body", () => {
  it("answers 415 for the wrong content type", async () => {
    const { deps } = harness();
    const res = await handleDograhWebhook(post(body(), { "content-type": "text/plain" }), deps);
    expect(res.status).toBe(415);
  });

  it("answers 413 for an oversized body", async () => {
    const { deps, store } = harness();
    const res = await handleDograhWebhook(post(body({ call_time: "x".repeat(9000) })), deps);
    expect(res.status).toBe(413);
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("answers 400 for invalid JSON", async () => {
    const { deps } = harness();
    const res = await handleDograhWebhook(post("{nope"), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["a user id in the body", { user_id: OTHER_USER }],
    ["a session id in the body", { session_id: SESSION }],
    ["a missing run id", { workflow_run_id: undefined }],
    ["a zero run id", { workflow_run_id: 0 }],
    ["a negative duration", { duration_seconds: -5 }],
    ["a text duration", { duration_seconds: "long" }],
    ["a missing token", { session_token: undefined }],
    ["a non-string url", { transcript_url: 5 }],
  ])("answers 400 for %s and does no work", async (_name, over) => {
    const { deps, store, fetchImpl } = harness();
    const res = await handleDograhWebhook(post(body(over)), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("accepts the run id and duration as numeric strings, and an empty disposition", async () => {
    const { deps, store } = harness();
    const res = await handleDograhWebhook(
      post(body({ workflow_run_id: "7", duration_seconds: "42", call_disposition: "" })),
      deps,
    );
    expect(res.status).toBe(200);
    expect(store.storeOnce.mock.calls[0][0].metadata).toMatchObject({ durationSeconds: 42 });
  });
});

describe("handleDograhWebhook: session token", () => {
  it.each([
    ["a token signed with another secret", () => makeToken({ secret: "another-secret-0123456789-abcdefghijklmnopq", nowMs: NOW })],
    ["an expired token", () => makeToken({ nowMs: NOW - 3_600_000, ttlSeconds: 60 })],
    ["garbage", () => "not-a-token"],
  ])("answers 401 for %s without downloading or storing", async (_name, make) => {
    const { deps, store, fetchImpl } = harness();
    const res = await handleDograhWebhook(post(body({ session_token: make() })), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_session_token");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("takes the user and session from the token only", async () => {
    const { deps, store } = harness();
    const token = makeToken({ userId: OTHER_USER, sessionId: "44444444-4444-4444-8444-444444444444", nowMs: NOW });
    const res = await handleDograhWebhook(post(body({ session_token: token })), deps);
    expect(res.status).toBe(200);
    expect(store.storeOnce.mock.calls[0][0]).toMatchObject({
      userId: OTHER_USER,
      sessionId: "44444444-4444-4444-8444-444444444444",
    });
  });
});

describe("handleDograhWebhook: transcript download", () => {
  it("answers 422 for a URL on another origin and never fetches it", async () => {
    const { deps, fetchImpl, store } = harness();
    const res = await handleDograhWebhook(
      post(body({ transcript_url: "http://169.254.169.254/latest/meta-data/" })),
      deps,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_transcript_url");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("answers 502 when the download fails, without leaking the URL", async () => {
    const { deps, store } = harness({
      fetchImpl: (async () => new Response("no", { status: 500 })) as never,
    });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("transcript_unavailable");
    expect(text).not.toContain("PUBLIC-TOKEN");
    expect(logged).not.toContain("PUBLIC-TOKEN");
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("stores an empty transcript when the call produced none", async () => {
    const { deps, store, fetchImpl } = harness();
    const res = await handleDograhWebhook(post(body({ transcript_url: null })), deps);
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.storeOnce.mock.calls[0][0].transcript).toEqual([]);
  });

  it("answers 422 when the file is not a Dograh transcript", async () => {
    const { deps, store } = harness({
      fetchImpl: (async () => new Response("<html>login page</html>")) as never,
    });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_transcript");
    expect(store.storeOnce).not.toHaveBeenCalled();
  });

  it("answers 422 when the transcript exceeds the shared size limits", async () => {
    const huge = `user: ${"word ".repeat(6000)}\n`;
    const { deps, store } = harness({ fetchImpl: (async () => new Response(huge)) as never });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(422);
    expect(store.storeOnce).not.toHaveBeenCalled();
  });
});

describe("handleDograhWebhook: storing", () => {
  it("stores canonical turns once and answers 200", async () => {
    const { deps, store } = harness();
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      success: true,
      session: { id: SESSION, status: "completed" },
      transcript: { source: "dograh_webhook", entries: 3 },
    });
    expect(store.storeOnce).toHaveBeenCalledTimes(1);
    const input = store.storeOnce.mock.calls[0][0] as StoreTranscriptInput;
    expect(input).toMatchObject({
      sessionId: SESSION,
      userId: USER,
      endedAtIso: new Date(NOW).toISOString(),
      metadata: { source: "dograh_webhook", durationSeconds: 42, endedReason: "user_ended" },
    });
    expect(input.transcript.map((t) => t.role)).toEqual(["interviewer", "candidate", "interviewer"]);
  });

  it("answers 200 duplicate when Dograh delivers the same webhook again", async () => {
    const { deps } = harness({}, { kind: "already_stored" });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, duplicate: true });
  });

  it("answers 404 when the session is not the token's user's", async () => {
    const { deps } = harness({}, { kind: "not_found" });
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(404);
  });

  it("answers a generic 500 when the store throws", async () => {
    const { deps, store } = harness();
    store.storeOnce.mockRejectedValueOnce(new Error(`boom ${TRANSCRIPT_TEXT}`));
    const res = await handleDograhWebhook(post(body()), deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("storage_failed");
    expect(text).not.toContain("boom");
    expect(text).not.toContain("database indexes");
  });

  it("never logs transcript text, the transcript URL or a token", async () => {
    const { deps, store } = harness({
      fetchImpl: (async () => new Response("x", { status: 500 })) as never,
    });
    await handleDograhWebhook(post(body()), deps);
    store.storeOnce.mockRejectedValueOnce(new Error("db down"));
    await handleDograhWebhook(post(body({ session_token: "bad" })), harness().deps);
    for (const secret of ["database indexes", "PUBLIC-TOKEN", WEBHOOK_SECRET, SESSION_SECRET]) {
      expect(logged).not.toContain(secret);
    }
  });
});
