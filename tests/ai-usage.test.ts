import { describe, expect, it } from "vitest";
import {
  checkQuota,
  DEFAULT_DAILY_CALL_LIMIT,
  QUOTA_WINDOW_MS,
  readDailyCallLimit,
  type UsageStore,
} from "@/lib/ai/usage";

describe("readDailyCallLimit", () => {
  it("defaults when unset or blank", () => {
    expect(readDailyCallLimit({})).toEqual({ ok: true, limit: DEFAULT_DAILY_CALL_LIMIT });
    expect(readDailyCallLimit({ AI_DAILY_CALL_LIMIT: "  " })).toEqual({
      ok: true,
      limit: DEFAULT_DAILY_CALL_LIMIT,
    });
  });

  it("accepts an integer in range", () => {
    expect(readDailyCallLimit({ AI_DAILY_CALL_LIMIT: "5" })).toEqual({ ok: true, limit: 5 });
  });

  it.each(["0", "-3", "1.5", "abc", "10001"])("rejects %j", (v) => {
    const r = readDailyCallLimit({ AI_DAILY_CALL_LIMIT: v });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.invalid).toMatch(/AI_DAILY_CALL_LIMIT/);
  });
});

describe("checkQuota", () => {
  const NOW = Date.parse("2026-11-10T12:00:00Z");
  function store(used: number) {
    const calls: { userId: string; since: string }[] = [];
    const s: UsageStore = {
      async countSince(userId, since) {
        calls.push({ userId, since });
        return used;
      },
      async record() {},
    };
    return { s, calls };
  }

  it("allows below the limit and blocks at it", async () => {
    expect((await checkQuota(store(2).s, "u", 3, NOW)).allowed).toBe(true);
    expect(await checkQuota(store(3).s, "u", 3, NOW)).toEqual({
      allowed: false,
      used: 3,
      limit: 3,
    });
  });

  it("counts a rolling 24h window for the given user", async () => {
    const { s, calls } = store(0);
    await checkQuota(s, "user-1", 3, NOW);
    expect(calls[0]).toEqual({
      userId: "user-1",
      since: new Date(NOW - QUOTA_WINDOW_MS).toISOString(),
    });
  });
});
