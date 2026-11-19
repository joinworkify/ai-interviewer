import { describe, expect, it, vi } from "vitest";

import {
  handleCancelBooking,
  handleCreateBooking,
  handleListBookings,
  MAX_UPCOMING_BOOKINGS,
  validateSlot,
  type BookingHandlerDeps,
  type BookingRecord,
} from "@/lib/candidate/booking";
import { composeBookingEmail } from "@/lib/notifications/booking-email";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BID = "22222222-2222-4222-8222-222222222222";
const iso = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("validateSlot", () => {
  it.each([
    [60, null],
    [30, null],
    [29 * 1, "Choose a time on the hour or half hour."],
    [90, null],
    [20, "Choose a time on the hour or half hour."],
    [0, "Choose a time at least 30 minutes from now."],
    [-60, "Choose a time at least 30 minutes from now."],
    [14 * 24 * 60, null],
    [14 * 24 * 60 + 30, "You can book up to 14 days ahead."],
  ])("%i minutes ahead -> %s", (m, expected) => {
    expect(validateSlot(new Date(iso(m)), NOW)).toBe(expected);
  });
  it("rejects invalid dates and odd seconds", () => {
    expect(validateSlot(new Date("nope"), NOW)).toBe("Choose a valid time.");
    expect(validateSlot(new Date("2026-11-20T12:00:30.000Z"), NOW)).toBe("Choose a time on the hour or half hour.");
  });
});

function setup(over: { userId?: string | null; active?: boolean; upcoming?: BookingRecord[]; cancels?: boolean } = {}) {
  const create = vi.fn(async () => ({ id: BID }));
  const cancel = vi.fn(async () => over.cancels ?? true);
  const onCreated = vi.fn();
  const deps: BookingHandlerDeps = {
    getUserId: async () => (over.userId === undefined ? ME : over.userId),
    store: { isActiveRole: async () => over.active ?? true, listUpcoming: async () => over.upcoming ?? [], create, cancel },
    onCreated,
    now: () => NOW,
  };
  return { deps, create, cancel, onCreated };
}

describe("handleCreateBooking", () => {
  const body = { roleId: "data-analyst", startsAt: iso(120) };
  it("books a valid slot for the signed-in user and triggers the confirmation", async () => {
    const t = setup();
    const res = await handleCreateBooking(post(body), t.deps);
    expect(res.status).toBe(201);
    expect(t.create).toHaveBeenCalledWith({ userId: ME, roleId: "data-analyst", startsAt: new Date(body.startsAt) });
    expect(t.onCreated).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, bookingId: BID }));
  });
  it.each([
    ["signed out", { userId: null }, body, 401],
    ["an inactive role", { active: false }, body, 404],
    ["a bad role id", {}, { ...body, roleId: "Bad Role!" }, 400],
    ["a time too soon", {}, { ...body, startsAt: iso(10) }, 400],
    ["a missing time", {}, { roleId: "data-analyst" }, 400],
  ])("rejects %s", async (_l, over, b, status) => {
    const t = setup(over as never);
    expect((await handleCreateBooking(post(b), t.deps)).status).toBe(status);
    expect(t.create).not.toHaveBeenCalled();
  });
  it("limits upcoming bookings and refuses a double booking", async () => {
    const mk = (m: number): BookingRecord => ({ id: String(m), roleId: "r", roleTitle: null, startsAt: iso(m) });
    const full = setup({ upcoming: Array.from({ length: MAX_UPCOMING_BOOKINGS }, (_, i) => mk(300 + i * 60)) });
    expect((await handleCreateBooking(post(body), full.deps)).status).toBe(409);
    const clash = setup({ upcoming: [mk(120)] });
    expect(await (await handleCreateBooking(post(body), clash.deps)).json()).toMatchObject({ error: "booking_conflict" });
    expect(full.create).not.toHaveBeenCalled();
  });
});

describe("list and cancel", () => {
  it("lists only for a signed-in user", async () => {
    expect((await handleListBookings(setup({ userId: null }).deps)).status).toBe(401);
    expect((await handleListBookings(setup().deps)).status).toBe(200);
  });
  it("cancels the caller's own booking; otherwise 404", async () => {
    const t = setup();
    expect((await handleCancelBooking(BID, t.deps)).status).toBe(200);
    expect(t.cancel).toHaveBeenCalledWith(ME, BID);
    expect((await handleCancelBooking(BID, setup({ cancels: false }).deps)).status).toBe(404);
    expect((await handleCancelBooking("nope", setup().deps)).status).toBe(404);
    expect((await handleCancelBooking(BID, setup({ userId: null }).deps)).status).toBe(401);
  });
});

describe("composeBookingEmail", () => {
  const input = { name: "Aye", roleTitle: "Data Analyst", startsAt: new Date("2026-11-21T09:30:00Z"), link: "https://app.example/candidate/applications" };
  it("confirms the time, role and link", () => {
    const m = composeBookingEmail("confirmation", input);
    expect(m.subject).toMatch(/booked/i);
    expect(m.text).toContain("Hi Aye,");
    expect(m.text).toContain("Data Analyst");
    expect(m.text).toContain("09:30 UTC");
    expect(m.text).toContain(input.link);
  });
  it("reminds, and copes with missing details", () => {
    const m = composeBookingEmail("reminder", { ...input, name: null, roleTitle: null, link: null });
    expect(m.subject).toMatch(/coming up/i);
    expect(m.text.startsWith("Hello,")).toBe(true);
    expect(m.text).not.toContain("http");
  });
});
