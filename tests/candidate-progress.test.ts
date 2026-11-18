import { describe, expect, it, vi } from "vitest";
import { STALE_ATTEMPT_MINUTES } from "@/lib/candidate/attempts";
import { handleGetProgress, type ProgressHandlerDeps } from "@/lib/candidate/progress";
import { getProgress, ProgressError } from "@/lib/candidate/progress-client";

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-16T10:00:00.000Z");

function setup(
  overrides: Partial<ProgressHandlerDeps["store"]> = {},
  userId: string | null = USER,
) {
  const findOpenAttempt = vi.fn().mockResolvedValue(null);
  const hasUploadedResume = vi.fn().mockResolvedValue(false);
  const deps: ProgressHandlerDeps = {
    getUserId: async () => userId,
    store: { findOpenAttempt, hasUploadedResume, ...overrides },
    now: () => NOW,
  };
  return { deps, findOpenAttempt, hasUploadedResume };
}

const get = (query: string) => new Request(`http://localhost/api/candidate/progress${query}`);

describe("handleGetProgress", () => {
  it("answers 401 without a session and reads nothing", async () => {
    const { deps, findOpenAttempt, hasUploadedResume } = setup({}, null);
    const res = await handleGetProgress(get("?role=software-engineer"), deps);
    expect(res.status).toBe(401);
    expect(findOpenAttempt).not.toHaveBeenCalled();
    expect(hasUploadedResume).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "?role=",
    "?role=Software Engineer",
    "?role=-x",
    "?role=a--b",
    `?role=${"a".repeat(81)}`,
  ])("answers 400 for the role query %j", async (query) => {
    const { deps, findOpenAttempt } = setup();
    expect((await handleGetProgress(get(query), deps)).status).toBe(400);
    expect(findOpenAttempt).not.toHaveBeenCalled();
  });

  it("reports no open attempt and no resume", async () => {
    const { deps } = setup();
    const res = await handleGetProgress(get("?role=software-engineer"), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      progress: { roleId: "software-engineer", resume: { uploaded: false }, attempt: null },
    });
  });

  it("reports the open attempt and an uploaded resume", async () => {
    const { deps } = setup({
      findOpenAttempt: async () => ({ id: SESSION }),
      hasUploadedResume: async () => true,
    });
    const body = await (await handleGetProgress(get("?role=software-engineer"), deps)).json();
    expect(body.progress).toEqual({
      roleId: "software-engineer",
      resume: { uploaded: true },
      attempt: { id: SESSION },
    });
  });

  it("looks up the verified user, ignoring any user id in the query, with the stale cutoff", async () => {
    const { deps, findOpenAttempt, hasUploadedResume } = setup();
    await handleGetProgress(get("?role=software-engineer&userId=someone-else&user_id=x"), deps);
    expect(findOpenAttempt).toHaveBeenCalledWith(
      USER,
      "software-engineer",
      new Date(NOW.getTime() - STALE_ATTEMPT_MINUTES * 60_000),
    );
    expect(hasUploadedResume).toHaveBeenCalledWith(USER);
  });

  it("returns only what a candidate may see", async () => {
    const { deps } = setup({
      // A store that returned more than asked for must not leak it.
      findOpenAttempt: async () =>
        ({ id: SESSION, transcript: [{ text: "secret" }], score: 80 }) as never,
    });
    const text = await (await handleGetProgress(get("?role=software-engineer"), deps)).text();
    expect(text).not.toMatch(/secret|transcript|score|feedback/);
  });

  it("answers 500 without leaking the cause when the store fails", async () => {
    const { deps } = setup({
      hasUploadedResume: async () => {
        throw new Error("password=hunter2");
      },
    });
    const res = await handleGetProgress(get("?role=software-engineer"), deps);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
  });
});

describe("getProgress (browser helper)", () => {
  const progress = { roleId: "software-engineer", resume: { uploaded: false }, attempt: null };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("asks for the role and returns the progress", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true, progress }));
    await expect(
      getProgress("software-engineer", fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual(progress);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/candidate/progress?role=software-engineer");
  });

  it("encodes the role id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { success: true, progress }));
    await getProgress("a&b", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/candidate/progress?role=a%26b");
  });

  it.each([
    ["an error status", () => Promise.resolve(json(401, { success: false }))],
    ["a body with no progress", () => Promise.resolve(json(200, { success: true }))],
    ["a non-JSON body", () => Promise.resolve(new Response("oops", { status: 200 }))],
    ["a network failure", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("throws ProgressError for %s", async (_label, impl) => {
    await expect(
      getProgress("software-engineer", vi.fn(impl) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ProgressError);
  });
});
