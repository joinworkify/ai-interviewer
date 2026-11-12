import { afterEach, describe, expect, it, vi } from "vitest";
import { filterRoles, getResult, isValidEmail, roleFromRow, type Role } from "@/lib/candidate/api";
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
  it("never returns a score or pass/fail", async () => {
    expect(Object.keys(await getResult("att_1", "complete")).sort()).toEqual(["attemptId", "status", "summary"]);
    expect((await getResult("att_1", "early")).status).toBe("incomplete");
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
