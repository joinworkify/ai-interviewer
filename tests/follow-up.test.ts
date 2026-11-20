import { describe, expect, it, vi } from "vitest";

import { handleListInbox, handleMarkInboxRead, INBOX_LIMIT, type InboxHandlerDeps } from "@/lib/candidate/inbox";
import { stageNotice } from "@/lib/notifications/inbox";
import {
  BOOKING_REMINDER_WINDOW_MINUTES,
  isAuthorizedCron,
  MAX_PER_RUN,
  runReminders,
  UNFINISHED_MAX_HOURS,
  UNFINISHED_MIN_HOURS,
  type ReminderDeps,
} from "@/lib/notifications/reminders";
import { composeStageEmail } from "@/lib/notifications/review-notify";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function deps(over: Partial<ReminderDeps> = {}) {
  const d: ReminderDeps = {
    dueBookings: vi.fn(async () => []),
    remindBooking: vi.fn(async () => {}),
    unfinishedAttempts: vi.fn(async () => []),
    remindUnfinished: vi.fn(async () => {}),
    ...over,
  };
  return d;
}
const booking = (id: string) => ({ id, userId: "u", roleId: "r", startsAt: new Date(NOW.getTime() + 20 * 60_000) });

describe("runReminders", () => {
  it("asks for bookings in the next hour and attempts started 2h-72h ago", async () => {
    const d = deps();
    await runReminders(d, NOW);
    expect(d.dueBookings).toHaveBeenCalledWith(NOW, BOOKING_REMINDER_WINDOW_MINUTES, MAX_PER_RUN);
    const [from, to] = (d.unfinishedAttempts as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(NOW.getTime() - from.getTime()).toBe(UNFINISHED_MAX_HOURS * 3_600_000);
    expect(NOW.getTime() - to.getTime()).toBe(UNFINISHED_MIN_HOURS * 3_600_000);
  });

  it("reminds each due item and reports counts", async () => {
    const d = deps({
      dueBookings: vi.fn(async () => [booking("b1"), booking("b2")]),
      unfinishedAttempts: vi.fn(async () => [{ sessionId: "s1", userId: "u" }]),
    });
    expect(await runReminders(d, NOW)).toEqual({
      bookings: { due: 2, sent: 2, failed: 0 },
      unfinished: { due: 1, sent: 1, failed: 0 },
    });
    expect(d.remindBooking).toHaveBeenCalledTimes(2);
    expect(d.remindUnfinished).toHaveBeenCalledWith({ sessionId: "s1", userId: "u" });
  });

  it("keeps going when one reminder fails, and counts it for the next run to retry", async () => {
    const remindBooking = vi.fn(async (b: { id: string }) => {
      if (b.id === "b1") throw new Error("smtp down");
    });
    const d = deps({ dueBookings: vi.fn(async () => [booking("b1"), booking("b2")]), remindBooking });
    const r = await runReminders(d, NOW);
    expect(r.bookings).toEqual({ due: 2, sent: 1, failed: 1 });
    expect(remindBooking).toHaveBeenCalledTimes(2);
  });
});

describe("isAuthorizedCron", () => {
  const secret = "a-long-random-secret-123";
  it("accepts only the exact Bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(`bearer ${secret}`, secret)).toBe(false);
    expect(isAuthorizedCron(secret, secret)).toBe(false);
    expect(isAuthorizedCron(null, secret)).toBe(false);
  });
  it("is closed when no usable secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
  });
});

describe("notices and emails for the new stages", () => {
  it("received: thanks the candidate, mentions the role, no score", () => {
    const m = composeStageEmail("received", { name: "Aye", roleTitle: "Analyst" }, null);
    expect(m.subject).toMatch(/received/i);
    expect(m.text).toContain("Analyst");
    expect(m.text).not.toMatch(/score/i);
  });
  it("unfinished: invites them back kindly", () => {
    const m = composeStageEmail("unfinished", { name: null, roleTitle: null }, "https://app.example/x");
    expect(m.subject).toMatch(/finish/i);
    expect(m.text).toContain("https://app.example/x");
  });
  it("every stage has an in-app notice that links inside the app", () => {
    for (const s of ["received", "in_review", "accepted", "not_selected", "unfinished"] as const) {
      const n = stageNotice(s, "Analyst");
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.link.startsWith("/")).toBe(true);
    }
  });
});

describe("candidate inbox handlers", () => {
  function inbox(userId: string | null = "u") {
    const markAllRead = vi.fn(async () => {});
    const list = vi.fn(async () => [{ id: "1", kind: "received", title: "t", body: "b", link: "/x", read: false, createdAt: "t" }]);
    const d: InboxHandlerDeps = { getUserId: async () => userId, store: { list, unreadCount: async () => 3, markAllRead } };
    return { d, list, markAllRead };
  }
  it("lists the caller's own notifications with the unread count", async () => {
    const t = inbox();
    const body = await (await handleListInbox(t.d)).json();
    expect(body).toMatchObject({ success: true, unread: 3 });
    expect(body.notifications).toHaveLength(1);
    expect(t.list).toHaveBeenCalledWith("u", INBOX_LIMIT);
  });
  it("marks only the caller's notifications read", async () => {
    const t = inbox();
    expect((await handleMarkInboxRead(t.d)).status).toBe(200);
    expect(t.markAllRead).toHaveBeenCalledWith("u");
  });
  it("requires sign-in", async () => {
    expect((await handleListInbox(inbox(null).d)).status).toBe(401);
    const t = inbox(null);
    expect((await handleMarkInboxRead(t.d)).status).toBe(401);
    expect(t.markAllRead).not.toHaveBeenCalled();
  });
  it("answers a storage failure without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d: InboxHandlerDeps = {
      getUserId: async () => "u",
      store: { list: async () => { throw new Error("secret db detail"); }, unreadCount: async () => 0, markAllRead: async () => {} },
    };
    const res = await handleListInbox(d);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
