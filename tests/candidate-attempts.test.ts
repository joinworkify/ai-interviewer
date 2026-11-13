import { describe, expect, it, vi } from "vitest";

import { ApiError, giveConsentAndCreateAttempt } from "@/lib/candidate/api";
import {
  ATTEMPT_DURATION_MINUTES,
  MAX_ATTEMPT_QUESTIONS,
  buildRoleQuestions,
  findRole,
  handleStartAttempt,
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

function deps(over: Partial<{ userId: string | null; store: AttemptStore }> = {}) {
  const createAttempt = vi.fn(async () => ({ sessionId: SESSION }));
  const store: AttemptStore = over.store ?? { createAttempt };
  return {
    createAttempt,
    deps: {
      getUserId: async () => (over.userId === undefined ? USER : over.userId),
      store,
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
    const res = await handleStartAttempt(post({ roleId: "software-engineer" }), d);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      success: true,
      attempt: { sessionId: SESSION, roleId: "software-engineer" },
    });
    expect(createAttempt).toHaveBeenCalledWith(USER, buildRoleQuestions(findRole("software-engineer")!));
  });

  it("answers 401 and writes nothing when nobody is signed in", async () => {
    const { deps: d, createAttempt } = deps({ userId: null });
    const res = await handleStartAttempt(post({ roleId: "software-engineer" }), d);
    expect(res.status).toBe(401);
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown role", async () => {
    const { deps: d, createAttempt } = deps();
    const res = await handleStartAttempt(post({ roleId: "no-such-role" }), d);
    expect(res.status).toBe(404);
    expect(createAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ["a user id in the body", { roleId: "software-engineer", userId: "x" }],
    ["questions in the body", { roleId: "software-engineer", questions: ["a"] }],
    ["no roleId", {}],
    ["a numeric roleId", { roleId: 5 }],
    ["an unsafe roleId", { roleId: "../etc/passwd" }],
    ["an overlong roleId", { roleId: "a".repeat(81) }],
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
    const res = await handleStartAttempt(post({ roleId: "x", pad: "y".repeat(2000) }), d);
    expect(res.status).toBe(413);
  });

  it("answers a generic 500 when the store throws, leaking nothing", async () => {
    const { deps: d } = deps({
      store: {
        createAttempt: async () => {
          throw new Error("secret row value leaked");
        },
      },
    });
    const res = await handleStartAttempt(post({ roleId: "software-engineer" }), d);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("leaked");
  });
});

describe("createSupabaseAttemptStore", () => {
  function fakeClient(opts: { interviewError?: boolean; sessionError?: boolean }) {
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
          // `await client.from(..).delete().eq(..).eq(..)` resolves the chain itself.
          then(resolve: (v: { error: null }) => void) {
            resolve({ error: null });
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

  it("writes the interview, then the session for the same user, and returns the session id", async () => {
    const { client, calls } = fakeClient({});
    const store = createSupabaseAttemptStore(client as never);
    expect(await store.createAttempt(USER, ["q1", "q2"])).toEqual({ sessionId: SESSION });
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
  });

  it("creates no session when the interview insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient({ interviewError: true });
    await expect(createSupabaseAttemptStore(client as never).createAttempt(USER, ["q"])).rejects.toThrow();
    expect(calls.map((c) => c.table)).toEqual(["interviews"]);
  });

  it("deletes the interview (for this user only) when the session insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, calls } = fakeClient({ sessionError: true });
    await expect(createSupabaseAttemptStore(client as never).createAttempt(USER, ["q"])).rejects.toThrow();
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("interviews");
    expect(del?.eq).toEqual([
      ["id", "iv-1"],
      ["user_id", USER],
    ]);
  });
});

describe("giveConsentAndCreateAttempt", () => {
  it("posts the role id and returns the session id as the attempt id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ success: true, attempt: { sessionId: SESSION, roleId: "generalist" } }, { status: 201 }),
    );
    expect(await giveConsentAndCreateAttempt("generalist", fetchImpl as never)).toEqual({ attemptId: SESSION });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/candidate/attempts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleId: "generalist" });
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

  it("throws an ApiError when the network fails", async () => {
    await expect(
      giveConsentAndCreateAttempt("generalist", (async () => {
        throw new TypeError("offline");
      }) as never),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});
