import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { composeBookingEmail } from "./booking-email";
import { createEmailSender } from "./email";
import { announceStage } from "./events";
import { createSupabaseInboxWriter } from "./inbox-store";
import type { ReminderDeps } from "./reminders";

/** The real reminder dependencies (service role). Callers must have checked the cron secret. */
export function createReminderDeps(): ReminderDeps {
  const db = createAdminClient();
  return {
    async dueBookings(now, windowMinutes, limit) {
      const { data, error } = await db
        .from("interview_bookings")
        .select("id, user_id, role_id, starts_at")
        .eq("status", "scheduled")
        .is("reminder_sent_at", null)
        .gte("starts_at", now.toISOString())
        .lte("starts_at", new Date(now.getTime() + windowMinutes * 60_000).toISOString())
        .order("starts_at", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((b) => ({ id: b.id, userId: b.user_id, roleId: b.role_id, startsAt: new Date(b.starts_at) }));
    },

    async remindBooking(b) {
      const [profile, role] = await Promise.all([
        db.from("profiles").select("name, email").eq("id", b.userId).maybeSingle(),
        db.from("roles").select("title").eq("id", b.roleId).maybeSingle(),
      ]);
      await createSupabaseInboxWriter(db).add({
        userId: b.userId,
        kind: "booking_reminder",
        sessionId: b.id,
        title: "Your interview is coming up",
        body: `${role.data?.title ?? "Your interview"} starts soon. Find a quiet place and check your microphone.`,
        link: `/candidate/roles/${b.roleId}`,
      });
      const send = createEmailSender(process.env);
      if (send && profile.data?.email) {
        const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
        const message = composeBookingEmail("reminder", {
          name: profile.data.name,
          roleTitle: role.data?.title ?? null,
          startsAt: b.startsAt,
          link: origin ? `${origin}/candidate/roles/${b.roleId}` : null,
        });
        if (!(await send({ to: profile.data.email, ...message }))) throw new Error("reminder email failed");
      }
      const { error } = await db.from("interview_bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
      if (error) throw error;
    },

    async unfinishedAttempts(from, to, limit) {
      const { data, error } = await db
        .from("interview_sessions")
        .select("id, user_id, started_at")
        .in("status", ["in_progress", "abandoned"])
        .is("transcript", null)
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString())
        .order("started_at", { ascending: true })
        .limit(limit * 3);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const users = [...new Set(rows.map((r) => r.user_id))];
      const [already, done] = await Promise.all([
        db.from("candidate_notifications").select("session_id").eq("stage", "unfinished").in("session_id", ids),
        // Anyone who has since completed an interview is not "unfinished".
        db.from("interview_sessions").select("user_id, started_at").in("user_id", users).not("transcript", "is", null),
      ]);
      if (already.error || done.error) throw already.error ?? done.error;
      const notified = new Set((already.data ?? []).map((r) => r.session_id));
      return rows
        .filter(
          (r) =>
            !notified.has(r.id) &&
            !(done.data ?? []).some((d) => d.user_id === r.user_id && d.started_at >= r.started_at),
        )
        // One reminder per person per run, even with several abandoned attempts.
        .filter((r, i, all) => all.findIndex((x) => x.user_id === r.user_id) === i)
        .slice(0, limit)
        .map((r) => ({ sessionId: r.id, userId: r.user_id }));
    },

    async remindUnfinished(a) {
      await announceStage(a.sessionId, "unfinished", { email: true });
    },
  };
}
