import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

import { ROLE_ID_RE } from "./attempts";

/**
 * Booking a time to take the interview. The AI interview can be taken any
 * time; a booking is a time the candidate commits to, with a confirmation and
 * a reminder email, so people who are not ready now still come back.
 *
 *   GET    /api/candidate/bookings        the caller's upcoming bookings
 *   POST   /api/candidate/bookings        { roleId, startsAt }
 *   DELETE /api/candidate/bookings/:id    cancel one of the caller's own
 *
 * Framework-agnostic (Request -> Response) with injected dependencies. The
 * user id comes only from verified Supabase claims.
 */

export const MIN_LEAD_MINUTES = 30;
export const MAX_AHEAD_DAYS = 14;
export const MAX_UPCOMING_BOOKINGS = 2;
const MAX_BODY_BYTES = 512;

export interface BookingRecord {
  id: string;
  roleId: string;
  roleTitle: string | null;
  startsAt: string;
}

export interface BookingStore {
  isActiveRole(roleId: string): Promise<boolean>;
  listUpcoming(userId: string, now: Date): Promise<BookingRecord[]>;
  create(args: { userId: string; roleId: string; startsAt: Date }): Promise<{ id: string }>;
  /** Cancels the user's own booking; false when it is not theirs or already gone. */
  cancel(userId: string, bookingId: string): Promise<boolean>;
}

export interface BookingHandlerDeps {
  getUserId: () => Promise<string | null>;
  store: BookingStore;
  /** Runs after a booking is created (confirmation email). Best effort. */
  onCreated?: (booking: { userId: string; bookingId: string; roleId: string; startsAt: Date }) => void;
  now?: () => Date;
}

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

/** Half-hour slots between the minimum lead time and the booking horizon. */
export function validateSlot(startsAt: Date, now: Date): string | null {
  if (Number.isNaN(startsAt.getTime())) return "Choose a valid time.";
  if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0 || ![0, 30].includes(startsAt.getUTCMinutes())) {
    return "Choose a time on the hour or half hour.";
  }
  if (startsAt.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000) {
    return `Choose a time at least ${MIN_LEAD_MINUTES} minutes from now.`;
  }
  if (startsAt.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) {
    return `You can book up to ${MAX_AHEAD_DAYS} days ahead.`;
  }
  return null;
}

export async function handleListBookings(deps: BookingHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  try {
    return jsonResponse(200, { success: true, bookings: await deps.store.listUpcoming(userId, (deps.now ?? (() => new Date()))()) });
  } catch {
    return fail(500, "storage_failed", "Could not load your bookings.");
  }
}

export async function handleCreateBooking(request: Request, deps: BookingHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  const now = (deps.now ?? (() => new Date()))();

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const v = (body.value ?? {}) as Record<string, unknown>;
  if (typeof v.roleId !== "string" || !ROLE_ID_RE.test(v.roleId) || typeof v.startsAt !== "string") {
    return fail(400, "invalid_request", "Send roleId and startsAt.");
  }
  const startsAt = new Date(v.startsAt);
  const problem = validateSlot(startsAt, now);
  if (problem) return fail(400, "invalid_request", problem);

  try {
    if (!(await deps.store.isActiveRole(v.roleId))) return fail(404, "not_found", "This role is not available.");
    const upcoming = await deps.store.listUpcoming(userId, now);
    if (upcoming.length >= MAX_UPCOMING_BOOKINGS) {
      return fail(409, "booking_limit", `You can have ${MAX_UPCOMING_BOOKINGS} upcoming bookings. Cancel one to book another.`);
    }
    if (upcoming.some((b) => new Date(b.startsAt).getTime() === startsAt.getTime())) {
      return fail(409, "booking_conflict", "You already have a booking at that time.");
    }
    const { id } = await deps.store.create({ userId, roleId: v.roleId, startsAt });
    try {
      deps.onCreated?.({ userId, bookingId: id, roleId: v.roleId, startsAt });
    } catch {
      console.error("[booking] created hook failed");
    }
    return jsonResponse(201, { success: true, booking: { id, roleId: v.roleId, startsAt: startsAt.toISOString() } });
  } catch {
    return fail(500, "storage_failed", "Could not save your booking.");
  }
}

export async function handleCancelBooking(bookingId: string, deps: BookingHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  if (!isUuid(bookingId)) return fail(404, "not_found", "Booking not found.");
  try {
    return (await deps.store.cancel(userId, bookingId))
      ? jsonResponse(200, { success: true })
      : fail(404, "not_found", "Booking not found.");
  } catch {
    return fail(500, "storage_failed", "Could not cancel the booking.");
  }
}
