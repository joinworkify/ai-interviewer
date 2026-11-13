import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateStoredSession, type SubmitFeedback } from "@/lib/sessions/auto-evaluate";

const USER = "11111111-2222-4333-8444-555555555555";
const SESSION = "22222222-2222-4222-8222-222222222222";
const deps = { env: {}, store: {} as never, usage: {} as never };

beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

function submitReturning(res: Response | Error) {
  return vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as SubmitFeedback & ReturnType<typeof vi.fn>;
}

describe("evaluateStoredSession", () => {
  it("evaluates as the given user, for the given session, with no request body", async () => {
    const submit = submitReturning(Response.json({ success: true }, { status: 201 }));
    expect(await evaluateStoredSession(USER, SESSION, deps, submit)).toEqual({ kind: "evaluated" });
    const [request, sessionId, handlerDeps] = (submit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sessionId).toBe(SESSION);
    expect(await handlerDeps.getUserId()).toBe(USER);
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe("");
  });

  it("treats an existing feedback as done, not as a failure", async () => {
    const submit = submitReturning(Response.json({ error: "already_evaluated" }, { status: 409 }));
    expect(await evaluateStoredSession(USER, SESSION, deps, submit)).toEqual({ kind: "already_evaluated" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    [503, "server_misconfigured"],
    [429, "quota_exceeded"],
    [502, "llm_failed"],
    [409, "session_closed"],
  ])("reports status %i %s as a failure with its code only", async (status, code) => {
    const submit = submitReturning(Response.json({ error: code, message: "model said SECRET-TEXT" }, { status }));
    expect(await evaluateStoredSession(USER, SESSION, deps, submit)).toEqual({ kind: "failed", status, code });
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).toContain(code);
    expect(logged).not.toContain("SECRET-TEXT");
  });

  it("falls back to an unknown code for an unreadable or unsafe error body", async () => {
    const html = submitReturning(new Response("<html>", { status: 500 }));
    expect(await evaluateStoredSession(USER, SESSION, deps, html)).toMatchObject({ code: "unknown" });
    const weird = submitReturning(Response.json({ error: "has spaces & <tags>" }, { status: 500 }));
    expect(await evaluateStoredSession(USER, SESSION, deps, weird)).toMatchObject({ code: "unknown" });
  });

  it("never throws, and logs no message from the thrown error", async () => {
    const submit = submitReturning(new Error("row value SECRET-ROW"));
    expect(await evaluateStoredSession(USER, SESSION, deps, submit)).toEqual({
      kind: "failed",
      status: 0,
      code: "exception",
    });
    expect((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ")).not.toContain("SECRET-ROW");
  });
});
