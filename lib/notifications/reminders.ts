/**
 * The scheduled reminder job. Pure selection and error isolation here; the
 * real database, email and inbox work is injected, so it is easy to test.
 *
 *  - Booking reminders: a booked interview starting within the next hour.
 *  - Unfinished applications: an interview started 2 hours to 3 days ago that
 *    never produced a transcript, and the candidate has not completed any
 *    interview since (so someone who already retried is left alone).
 *
 * Every reminder is sent at most once (the booking row records it; the other
 * is deduplicated by session and stage), so the job can run as often as the
 * scheduler likes, and a failed run is simply retried by the next one.
 */

export const BOOKING_REMINDER_WINDOW_MINUTES = 60;
export const UNFINISHED_MIN_HOURS = 2;
export const UNFINISHED_MAX_HOURS = 72;
export const MAX_PER_RUN = 50;

export interface DueBooking {
  id: string;
  userId: string;
  roleId: string;
  startsAt: Date;
}

export interface UnfinishedAttempt {
  sessionId: string;
  userId: string;
}

export interface ReminderDeps {
  dueBookings(now: Date, windowMinutes: number, limit: number): Promise<DueBooking[]>;
  /** Sends the reminder (inbox and email) and records it. Throws on failure. */
  remindBooking(booking: DueBooking): Promise<void>;
  unfinishedAttempts(from: Date, to: Date, limit: number): Promise<UnfinishedAttempt[]>;
  remindUnfinished(attempt: UnfinishedAttempt): Promise<void>;
}

export interface ReminderResult {
  bookings: { due: number; sent: number; failed: number };
  unfinished: { due: number; sent: number; failed: number };
}

async function each<T>(items: readonly T[], send: (item: T) => Promise<void>) {
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await send(item);
      sent += 1;
    } catch {
      // One bad row must not stop the rest; the next run tries it again.
      failed += 1;
    }
  }
  return { due: items.length, sent, failed };
}

export async function runReminders(deps: ReminderDeps, now: Date): Promise<ReminderResult> {
  const hours = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const bookings = await deps.dueBookings(now, BOOKING_REMINDER_WINDOW_MINUTES, MAX_PER_RUN);
  const unfinished = await deps.unfinishedAttempts(hours(UNFINISHED_MAX_HOURS), hours(UNFINISHED_MIN_HOURS), MAX_PER_RUN);
  return {
    bookings: await each(bookings, (b) => deps.remindBooking(b)),
    unfinished: await each(unfinished, (a) => deps.remindUnfinished(a)),
  };
}

/** Constant-time check of "Bearer <secret>". False when no secret is configured. */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
