import { describe, expect, it, vi } from "vitest";

import { ApiError, giveConsentAndCreateAttempt } from "@/lib/candidate/api";
import { CONSENT_VERSION } from "@/lib/candidate/consent";
import {
  ATTEMPT_DURATION_MINUTES,
  MAX_ATTEMPT_QUESTIONS,
  MAX_ATTEMPTS_PER_ROLE,
  STALE_ATTEMPT_MINUTES,
  buildRoleQuestions,
  findRole,
  attemptProgress,
  handleGetAttempt,
  handleStartAttempt,
  type AttemptSession,
  type AttemptStore,
} from "@/lib/candidate/attempts";
import { createSupabaseAttemptStore } from "@/lib/candidate/attempt-store";
import { interviewDetailsForRole, levelForRole } from "@/lib/candidate/interview-details";
import roles from "@/lib/candidate/roles.json";
import { sanitizeQuestions } from "@/lib/dograh/context";
import { validateLiveInterviewBody } from "@/lib/gemini-live/interview-details";

const USER = "11111111-2222-4333-8444-555555555555";
const SESSION = "22222222-2222-4222-8222-222222222222";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/candidate/attempts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = (over: Record<string, unknown> = {}) => ({
  roleId: "software-engineer",
  consentVersion: CONSENT_VERSION,
  ...over,
});

function deps(
  over: Partial<{ userId: string | null; store: AttemptStore; attemptCount: number }> = {},
) {
  const createAttempt = vi.fn(async () => ({ sessionId: SESSION }));
  const abandonStaleAttempts = vi.fn(async () => {});
  const countAttempts = vi.fn(async () => over.attemptCount ?? 0);
  const store: AttemptStore = over.store ?? { createAttempt, abandonStaleAttempts, countAttempts };
  return {
    createAttempt,
    abandonStaleAttempts,
    countAttempts,
    deps: {
      getUserId: async () => (over.userId === undefined ? USER : over.userId),
      store,
      sessions: { getSession: async () => null },
    },
  };
}

describe("buildRoleQuestions", () => {
  it.each(roles.map((r) => [r.id]))("builds a usable question set for %s", (id) => {
    const role = findRole(id)!;
    const questions = buildRoleQuestions(role);
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(MAX_ATTEMPT_QUESTIONS);
    expect(questions[0]).toContain(role.title);
    // The Dograh context keeps every question as it is (nothing dropped or cleaned).
    expect(sanitizeQuestions(questions)).toEqual(questions);
  });

  it("is deterministic", () => {
    const role = findRole("software-engineer")!;
    expect(buildRoleQuestions(role)).toEqual(buildRoleQuestions(role));
  });
});

describe("interviewDetailsForRole", () => {
  it.each(roles.map((r) => [r.id]))("gives details the Dograh session route accepts for %s", (id) => {
    const role = roles.find((r) => r.id === id)!;
    const result = validateLiveInterviewBody({ ...interviewDetailsForRole(role), sessionId: SESSION });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("infers the level from the title", () => {
    expect(levelForRole("Senior Software Engineer")).toBe("senior");
    expect(levelForRole("Mechanical Engineering Expert")).toBe("senior");
    expect(levelForRole("Software Engineer")).toBe("mid");
    expect(levelForRole("Generalist")).toBe("mid");
  });

  it("keeps at most 8 skills", () => {
    const skills = Array.from({ length: 12 }, (_, i) => `S${i}`);
    expect(interviewDetailsForRole({ title: "X", skills }).techstack.split(", ")).toHaveLength(8);
  });
});

describe("handleStartAttempt", () => {
  it("creates the attempt from the role's own questions and returns the session id", async () => {
    const { deps: d, createAttempt } = deps();
    const res = await handleStartAttempt(post(valid()), d);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      success: true,
      attempt: { sessionId: SESSION, roleId: "software-engineer" },
    });
    expect(createAttempt).toHaveBeenCalledWith(USER, buildRoleQuestions(findRole("software-engineer")!), {
      roleId: "software-engineer",
      version: CONSENT_VERSION,
    });
  });

  it("answers 409 and creates nothing when the consent text the page showed is out of date", async () => {
    const { deps: d, createAttempt } = deps();
    const res = await handleStartAttempt(post(valid({ consentVersion: "2020-01-01" })), d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("consent_outdated");
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("answers 401 and writes nothing when nobody is signed in", async () => {
    const { deps: d, createAttempt } = deps({ userId: null });
    const res = await handleStartAttempt(post(valid()), d);
    expect(res.status).toBe(401);
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown role", async () => {
    const { deps: d, createAttempt } = deps();
    const res = await handleStartAttempt(post(valid({ roleId: "no-such-role" })), d);
    expect(res.status).toBe(404);
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["a user id in the body", valid({ userId: "x" })],
    ["questions in the body", valid({ questions: ["a"] })],
    ["no roleId", { consentVersion: CONSENT_VERSION }],
    ["no consentVersion", { roleId: "software-engineer" }],
    ["a numeric consentVersion", valid({ consentVersion: 1 })],
    ["an empty consentVersion", valid({ consentVersion: "" })],
    ["an overlong consentVersion", valid({ consentVersion: "v".repeat(41) })],
    ["a numeric roleId", valid({ roleId: 5 })],
    ["an unsafe roleId", valid({ roleId: "../etc/passwd" })],
    ["an overlong roleId", valid({ roleId: "a".repeat(81) })],
    ["an array body", ["software-engineer"]],
    ["a null body", null],
  ])("answers 400 for %s", async (_label, body) => {
    const { deps: d, createAttempt } = deps();
    const res = await handleStartAttempt(post(body), d);
    expect(res.status).toBe(400);
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("answers 415 without a JSON content type and 400 for broken JSON", async () => {
    const { deps: d } = deps();
    const noType = await handleStartAttempt(
      new Request("http://localhost:3000/api/candidate/attempts", { method: "POST", body: "{}" }),
      d,
    );
    expect(noType.status).toBe(415);
    expect((await handleStartAttempt(post("{nope"), d)).status).toBe(400);
  });

  it("answers 413 for an oversized body", async () => {
    const { deps: d } = deps();
    const res = await handleStartAttempt(post(valid({ pad: "y".repeat(2000) })), d);
    expect(res.status).toBe(413);
  });

  it("answers a generic 500 when the store throws, leaking nothing", async () => {
    const { deps: d } = deps({
      store: {
        abandonStaleAttempts: async () => {},
        countAttempts: async () => 0,
        createAttempt: async () => {
          throw new Error("secret row value leaked");
        },
      },
    });
    const res = await handleStartAttempt(post(valid()), d);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("leaked");
  });

  it("closes the user's stale attempts before counting, using the stale cutoff", async () => {
    const now = new Date("2026-11-14T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const { deps: d, abandonStaleAttempts, countAttempts } = deps();
      await handleStartAttempt(post(valid()), d);
      expect(abandonStaleAttempts).toHaveBeenCalledWith(
        USER,
        new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000),
      );
      expect(abandonStaleAttempts.mock.invocationCallOrder[0]).toBeLessThan(
        countAttempts.mock.invocationCallOrder[0],
      );
      expect(countAttempts).toHaveBeenCalledWith(USER, "software-engineer");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows an attempt while the user is under the limit", async () => {
    const { deps: d, createAttempt } = deps({ attemptCount: MAX_ATTEMPTS_PER_ROLE - 1 });
    expect((await handleStartAttempt(post(valid()), d)).status).toBe(201);
    expect(createAttempt).toHaveBeenCalledTimes(1);
  });

  it("answers 429 attempt_limit and creates nothing once the limit is reached", async () => {
    const { deps: d, createAttempt } = deps({ attemptCount: MAX_ATTEMPTS_PER_ROLE });
    const res = await handleStartAttempt(post(valid()), d);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false, error: "attempt_limit" });
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("answers a generic 500 when the attempt count cannot be read", async () => {
    const { deps: d, createAttempt } = deps({
      store: {
        abandonStaleAttempts: async () => {},
        countAttempts: async () => {
          throw new Error("secret count failure");
        },
        createAttempt: vi.fn(),
      },
    });
    const res = await handleStartAttempt(post(valid()), d);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    expect(createAttempt).not.toHaveBeenCalled();
  });
});

describe("createSupabaseAttemptStore attempt limits", () => {
  function recordingClient(result: { count?: number | null; error?: unknown }) {
    const ops: [string, ...unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["update", "select", "eq", "neq", "is", "lt"]) {
      chain[m] = (...args: unknown[]) => {
        ops.push([m, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ count: result.count ?? null, error: result.error ?? null });
    return { client: { from: (t: string) => (ops.push(["from", t]), chain) }, ops };
  }

  it("abandons only this user's in_progress sessions with no transcript that began before the cutoff", async () => {
    const { client, ops } = recordingClient({});
    const cutoff = new Date("2026-11-14T11:30:00.000Z");
    await createSupabaseAttemptStore(client as never).abandonStaleAttempts(USER, cutoff);
    expect(ops).toContainEqual(["from", "interview_sessions"]);
    expect(ops.find((o) => o[0] === "update")?.[1]).toMatchObject({ status: "abandoned" });
    expect(ops).toContainEqual(["eq", "user_id", USER]);
    expect(ops).toContainEqual(["eq", "status", "in_progress"]);
    expect(ops).toContainEqual(["is", "transcript", null]);
    expect(ops).toContainEqual(["lt", "started_at", cutoff.toISOString()]);
  });

  it("counts the user's non-abandoned attempts for the role", async () => {
    const { client, ops } = recordingClient({ count: 2 });
    expect(await createSupabaseAttemptStore(client as never).countAttempts(USER, "generalist")).toBe(2);
    expect(ops).toContainEqual(["from", "candidate_consents"]);
    expect(ops).toContainEqual(["eq", "user_id", USER]);
    expect(ops).toContainEqual(["eq", "role_id", "generalist"]);
    expect(ops).toContainEqual(["neq", "interview_sessions.status", "abandoned"]);
  });

  it("throws, rather than reporting zero, when the count or the cleanup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = recordingClient({ error: { code: "XX000" } });
    await expect(createSupabaseAttemptStore(failing.client as never).countAttempts(USER, "generalist")).rejects.toThrow();
    await expect(
      createSupabaseAttemptStore(failing.client as never).abandonStaleAttempts(USER, new Date()),
    ).rejects.toThrow();
  });
});

describe("createSupabaseAttemptStore", () => {
  function fakeClient(opts: { interviewError?: boolean; sessionError?: boolean; consentError?: boolean }) {
    const calls: { table: string; op: string; row?: unknown; eq?: [string, unknown][] }[] = [];
    const client = {
      from(table: string) {
        const call: (typeof calls)[number] = { table, op: "" };
        calls.push(call);
        const chain = {
          insert(row: unknown) {
            call.op = "insert";
            call.row = row;
            return chain;
          },
          delete() {
            call.op = "delete";
            call.eq = [];
            return chain;
          },
          eq(col: string, value: unknown) {
            call.eq?.push([col, value]);
            return chain;
          },
          // `await client.from(..).delete().eq(..).eq(..)` and a bare
          // `await client.from(..).insert(..)` resolve the chain itself.
          then(resolve: (v: { error: unknown }) => void) {
            resolve({ error: table === "candidate_consents" && opts.consentError ? { code: "23505" } : null });
          },
          select() {
            return chain;
          },
          single() {
            if (table === "interviews") {
              return Promise.resolve(
                opts.interviewError
                  ? { data: null, error: { code: "23514" } }
                  : { data: { id: "iv-1" }, error: null },
              );
            }
            return Promise.resolve(
              opts.sessionError
                ? { data: null, error: { code: "23503" } }
                : { data: { id: SESSION }, error: null },
            );
          },
        };
        return chain;
      },
    };
    return { client, calls };
  }

  const CONSENT = { roleId: "generalist", version: CONSENT_VERSION };

  it("writes the interview, the session and the consent for the same user, and returns the session id", async () => {
    const { client, calls } = fakeClient({});
    const store = createSupabaseAttemptStore(client as never);
    expect(await store.createAttempt(USER, ["q1", "q2"], CONSENT)).toEqual({ sessionId: SESSION });
    expect(calls[0]).toMatchObject({
      table: "interviews",
      op: "insert",
      row: { user_id: USER, questions: ["q1", "q2"], duration_minutes: ATTEMPT_DURATION_MINUTES },
    });
    expect(calls[1]).toMatchObject({
      table: "interview_sessions",
      op: "insert",
      row: { user_id: USER, interview_id: "iv-1" },
    });
    expect(calls[2]).toMatchObject({
      table: "candidate_consents",
      op: "insert",
      row: { user_id: USER, session_id: SESSION, role_id: "generalist", consent_version: CONSENT_VERSION },
    });
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("deletes the interview (and with it the session) when the consent insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient({ consentError: true });
    await expect(createSupabaseAttemptStore(client as never).createAttempt(USER, ["q"], CONSENT)).rejects.toThrow();
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("interviews");
    expect(del?.eq).toEqual([
      ["id", "iv-1"],
      ["user_id", USER],
    ]);
  });

  it("creates no session when the interview insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient({ interviewError: true });
    await expect(createSupabaseAttemptStore(client as never).createAttempt(USER, ["q"], CONSENT)).rejects.toThrow();
    expect(calls.map((c) => c.table)).toEqual(["interviews"]);
  });

  it("deletes the interview (for this user only) when the session insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient({ sessionError: true });
    await expect(createSupabaseAttemptStore(client as never).createAttempt(USER, ["q"], CONSENT)).rejects.toThrow();
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("interviews");
    expect(del?.eq).toEqual([
      ["id", "iv-1"],
      ["user_id", USER],
    ]);
  });
});

describe("giveConsentAndCreateAttempt", () => {
  it("posts the role id and the consent version, and returns the session id as the attempt id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true, attempt: { sessionId: SESSION, roleId: "generalist" } }, { status: 201 }),
    );
    expect(await giveConsentAndCreateAttempt("generalist", fetchImpl as never)).toEqual({ attemptId: SESSION });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/candidate/attempts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleId: "generalist", consentVersion: CONSENT_VERSION });
  });

  it.each([
    ["a server error", () => Response.json({ success: false }, { status: 500 })],
    ["a 200 without a session id", () => Response.json({ success: true })],
    ["a non-JSON body", () => new Response("<html>", { status: 502 })],
  ])("throws an ApiError for %s", async (_label, make) => {
    await expect(giveConsentAndCreateAttempt("generalist", (async () => make()) as never)).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("tells the caller when the consent text is out of date", async () => {
    await expect(
      giveConsentAndCreateAttempt("generalist", (async () =>
        Response.json({ success: false, error: "consent_outdated" }, { status: 409 })) as never),
    ).rejects.toMatchObject({ code: "CONSENT_OUTDATED" });
  });

  it("tells the caller when the attempt limit is reached", async () => {
    await expect(
      giveConsentAndCreateAttempt("generalist", (async () =>
        Response.json({ success: false, error: "attempt_limit" }, { status: 429 })) as never),
    ).rejects.toMatchObject({ code: "ATTEMPT_LIMIT" });
  });

  it("throws an ApiError when the network fails", async () => {
    await expect(
      giveConsentAndCreateAttempt("generalist", (async () => {
        throw new TypeError("offline");
      }) as never),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});

const turns = (...t: [string, string][]) => t.map(([speaker, text]) => ({ speaker, text }));

describe("attemptProgress", () => {
  it.each([
    ["no transcript yet", { status: "in_progress", transcript: null }, "processing"],
    ["an abandoned session", { status: "abandoned", transcript: null }, "incomplete"],
    [
      "a transcript with a spoken answer",
      { status: "completed", transcript: turns(["interviewer", "Q?"], ["candidate", "An answer."]) },
      "submitted",
    ],
    [
      "a Vapi-shaped transcript with a spoken answer",
      { status: "completed", transcript: [{ role: "assistant", message: "Q?" }, { role: "user", message: "Yes." }] },
      "submitted",
    ],
    [
      "a transcript with only the interviewer talking",
      { status: "completed", transcript: turns(["interviewer", "Hello?"], ["interviewer", "Anyone there?"]) },
      "incomplete",
    ],
    ["an empty transcript", { status: "completed", transcript: [] }, "incomplete"],
    ["a blank candidate turn", { status: "completed", transcript: turns(["interviewer", "Q?"], ["candidate", "   "]) }, "incomplete"],
    [
      "a transcript too large to evaluate",
      { status: "completed", transcript: turns(["interviewer", "Q?"], ["candidate", "x".repeat(70_000)]) },
      "submitted",
    ],
  ])("is %s -> %s", (_label, session, expected) => {
    expect(attemptProgress(session as AttemptSession)).toBe(expected);
  });
});

describe("handleGetAttempt", () => {
  const sessions = (row: AttemptSession | null | Error) => ({
    getSession: vi.fn(async () => {
      if (row instanceof Error) throw row;
      return row;
    }),
  });
  const own = (over: Partial<AttemptSession> = {}): AttemptSession => ({
    user_id: USER,
    status: "completed",
    transcript: turns(["interviewer", "Q?"], ["candidate", "SECRET-ANSWER"]),
    ...over,
  });
  const call = (id: string, row: AttemptSession | null | Error, userId: string | null = USER) =>
    handleGetAttempt(id, { getUserId: async () => userId, sessions: sessions(row) });

  it("returns only the status for the caller's own attempt", async () => {
    const res = await call(SESSION, own());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: true, attempt: { sessionId: SESSION, status: "submitted" } });
    // Nothing a reviewer decides, and nothing the candidate said, comes back.
    expect(text).not.toMatch(/SECRET-ANSWER|transcript|feedback|score/i);
  });

  it("reports processing while the transcript has not arrived", async () => {
    const res = await call(SESSION, own({ status: "in_progress", transcript: null }));
    expect((await res.json()).attempt.status).toBe("processing");
  });

  it("answers 401 when nobody is signed in, without reading anything", async () => {
    const s = sessions(own());
    const res = await handleGetAttempt(SESSION, { getUserId: async () => null, sessions: s });
    expect(res.status).toBe(401);
    expect(s.getSession).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id, without reading anything", async () => {
    const s = sessions(own());
    const res = await handleGetAttempt("nope", { getUserId: async () => USER, sessions: s });
    expect(res.status).toBe(404);
    expect(s.getSession).not.toHaveBeenCalled();
  });

  it("answers 404 for a missing session and for someone else's, the same way", async () => {
    const missing = await call(SESSION, null);
    const foreign = await call(SESSION, own({ user_id: "99999999-2222-4333-8444-555555555555" }));
    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("answers a generic 500 when the store throws", async () => {
    const res = await call(SESSION, new Error("secret row value leaked"));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("leaked");
  });
});
