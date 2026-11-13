import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, filterRoles, getResult, isValidEmail, roleFromRow, waitForResult, type Role } from "@/lib/candidate/api";
import { formatCountdown, setupGate } from "@/lib/candidate/setup";
import { createFakeVoiceSession, type VoiceStatus } from "@/lib/candidate/voice";
import seedRoles from "@/lib/candidate/roles.json";

const ROLES: Role[] = seedRoles;

describe("roleFromRow", () => {
  it("maps a public.roles row and drops empty optional fields", () => {
    const role = roleFromRow({
      id: "x",
      title: "X",
      pay_rate: "$1~$2/Hour",
      job_type: "",
      skills: ["Go"],
      about: "",
      responsibilities: [{ title: "A", text: "a" }],
      requirements: null,
    });
    expect(role).toEqual({
      id: "x",
      title: "X",
      payRate: "$1~$2/Hour",
      jobType: undefined,
      skills: ["Go"],
      about: undefined,
      responsibilities: [{ title: "A", text: "a" }],
      requirements: [],
    });
  });
});

describe("filterRoles", () => {
  it("filters by title or skill, case-insensitively", () => {
    expect(filterRoles(ROLES, "")).toHaveLength(ROLES.length);
    expect(filterRoles(ROLES, "  SEMICONDUCTOR ").map((r) => r.id)).toEqual(["semiconductor-engineering-expert"]);
    expect(filterRoles(ROLES, "typescript").length).toBeGreaterThan(0);
    expect(filterRoles(ROLES, "no such role")).toEqual([]);
  });
});

describe("isValidEmail", () => {
  it("accepts only email-shaped input", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("  cand@datasea.test ")).toBe(true);
    for (const bad of ["", "abc", "a@b", "a b@c.d", "@b.co"]) expect(isValidEmail(bad)).toBe(false);
  });
});

describe("getResult", () => {
  const reply = (status: unknown, httpStatus = 200) =>
    vi.fn(async () => Response.json({ success: true, attempt: { sessionId: "s", status } }, { status: httpStatus }));

  it.each(["processing", "submitted", "incomplete"] as const)("maps %s from the server, with no score or pass/fail", async (status) => {
    const result = await getResult("s", reply(status) as never);
    expect(Object.keys(result).sort()).toEqual(["attemptId", "status", "summary"]);
    expect(result.status).toBe(status);
    expect(result.summary).not.toMatch(/score|pass|fail|reject|accept/i);
  });

  it("asks for the attempt by id, same origin, uncached", async () => {
    const f = reply("submitted");
    await getResult("a b", f as never);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/candidate/attempts/a%20b");
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });

  it.each([
    ["an unknown status", () => reply("scored")],
    ["a server error", () => reply("submitted", 500)],
    ["a 401", () => reply("submitted", 401)],
  ])("throws an ApiError for %s", async (_l, make) => {
    await expect(getResult("s", make() as never)).rejects.toBeInstanceOf(ApiError);
  });

  it("throws an ApiError when the network fails", async () => {
    await expect(
      getResult("s", (async () => {
        throw new TypeError("offline");
      }) as never),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("waitForResult", () => {
  const answers = (...statuses: unknown[]) => {
    let i = 0;
    return vi.fn(async () => {
      const status = statuses[Math.min(i++, statuses.length - 1)];
      if (status === "boom") throw new TypeError("offline");
      return Response.json({ success: true, attempt: { sessionId: "s", status } });
    });
  };
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it("polls until the transcript has arrived", async () => {
    const f = answers("processing", "processing", "submitted");
    const result = await waitForResult("s", { fetchImpl: f as never, intervalMs: 1000, timeoutMs: 30_000, ...clock() });
    expect(result.status).toBe("submitted");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("returns the last processing result at the timeout instead of failing", async () => {
    const f = answers("processing");
    const result = await waitForResult("s", { fetchImpl: f as never, intervalMs: 1000, timeoutMs: 5000, ...clock() });
    expect(result.status).toBe("processing");
    expect(f.mock.calls.length).toBeGreaterThan(1);
    expect(f.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("survives one failed poll", async () => {
    const f = answers("boom", "incomplete");
    const result = await waitForResult("s", { fetchImpl: f as never, intervalMs: 1000, timeoutMs: 30_000, ...clock() });
    expect(result.status).toBe("incomplete");
  });

  it("throws only when every poll failed", async () => {
    const f = answers("boom");
    await expect(
      waitForResult("s", { fetchImpl: f as never, intervalMs: 1000, timeoutMs: 3000, ...clock() }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = answers("processing");
    await expect(
      waitForResult("s", { fetchImpl: f as never, signal: controller.signal, ...clock() }),
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("setupGate", () => {
  it("only lets the candidate start once the mic check passed", () => {
    expect(setupGate("ok")).toEqual({ canStart: true, fix: null });
    for (const s of ["idle", "checking", "blocked", "unsupported", "silent"] as const) {
      const gate = setupGate(s);
      expect(gate.canStart).toBe(false);
      expect(gate.fix).toBeTruthy();
    }
    expect(setupGate("blocked").fix).toBe("Fix: allow microphone access");
  });

  it("formats the reconnect countdown", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(42)).toBe("0:42");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
describe("fake voice session", () => {
  afterEach(() => vi.useRealTimers());

  it("connects, asks every question, then ends; a drop shows reconnecting", () => {
    vi.useFakeTimers();
    const statuses: VoiceStatus[] = [];
    const captions: string[] = [];
    createFakeVoiceSession(
      { onStatus: (s) => statuses.push(s), onSpeaker: () => {}, onCaption: (c) => captions.push(c) },
      { script: ["Q1", "Q2"], dropOnce: true, turnMs: 10 },
    );
    vi.runAllTimers();
    expect(statuses).toEqual(["connecting", "connected", "reconnecting", "connected", "ended"]);
    expect(captions).toContain("Q1");
    expect(captions).toContain("Q2");
  });

  it("stop() cancels pending events", () => {
    vi.useFakeTimers();
    const statuses: VoiceStatus[] = [];
    const s = createFakeVoiceSession({ onStatus: (x) => statuses.push(x), onSpeaker: () => {}, onCaption: () => {} });
    s.stop();
    vi.runAllTimers();
    expect(statuses).toEqual(["connecting"]);
  });
});
