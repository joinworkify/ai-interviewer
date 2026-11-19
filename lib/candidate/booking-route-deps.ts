import "server-only";

import { after } from "next/server";

import { jsonResponse } from "@/lib/http/json";
import { describeError } from "@/lib/log/safe-error";
import { createEmailSender } from "@/lib/notifications/email";
import { composeBookingEmail } from "@/lib/notifications/booking-email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { BookingHandlerDeps } from "./booking";

/** Real dependencies for /api/candidate/bookings. Rows are read and written with the service role, always filtered by the verified user id. */
export async function runBookingRoute(run: (deps: BookingHandlerDeps) => Promise<Response>): Promise<Response> {
  const missing = [
    ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return jsonResponse(503, { success: false, error: "server_misconfigured", message: "Supabase is not configured on the server.", missing });
  }
  try {
    const supabase = await createClient();
    const db = createAdminClient();
    return await run({
      getUserId: async () => {
        const { data, error } = await supabase.auth.getClaims();
        const sub = data?.claims?.sub;
        return !error && typeof sub === "string" ? sub : null;
      },
      store: {
        async isActiveRole(roleId) {
          const { data, error } = await db.from("roles").select("id").eq("id", roleId).eq("is_active", true).maybeSingle();
          if (error) throw error;
          return data !== null;
        },
        async listUpcoming(userId, now) {
          const { data, error } = await db
            .from("interview_bookings")
            .select("id, role_id, starts_at")
            .eq("user_id", userId)
            .eq("status", "scheduled")
            .gte("starts_at", now.toISOString())
            .order("starts_at", { ascending: true });
          if (error) throw error;
          const ids = [...new Set((data ?? []).map((b) => b.role_id))];
          const roles = ids.length ? await db.from("roles").select("id, title").in("id", ids) : { data: [], error: null };
          if (roles.error) throw roles.error;
          const titles = new Map((roles.data ?? []).map((r) => [r.id, r.title]));
          return (data ?? []).map((b) => ({ id: b.id, roleId: b.role_id, roleTitle: titles.get(b.role_id) ?? null, startsAt: b.starts_at }));
        },
        async create({ userId, roleId, startsAt }) {
          const { data, error } = await db
            .from("interview_bookings")
            .insert({ user_id: userId, role_id: roleId, starts_at: startsAt.toISOString() })
            .select("id")
            .single();
          if (error) throw error;
          return { id: data.id };
        },
        async cancel(userId, bookingId) {
          const { data, error } = await db
            .from("interview_bookings")
            .update({ status: "cancelled" })
            .eq("id", bookingId)
            .eq("user_id", userId)
            .eq("status", "scheduled")
            .select("id");
          if (error) throw error;
          return (data ?? []).length > 0;
        },
      },
      // After the response: confirmation email (best effort).
      onCreated: ({ userId, roleId, startsAt }) => {
        after(async () => {
          try {
            const send = createEmailSender(process.env);
            if (!send) return;
            const [profile, role] = await Promise.all([
              db.from("profiles").select("name, email").eq("id", userId).maybeSingle(),
              db.from("roles").select("title").eq("id", roleId).maybeSingle(),
            ]);
            if (!profile.data?.email) return;
            const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
            const message = composeBookingEmail("confirmation", {
              name: profile.data.name,
              roleTitle: role.data?.title ?? null,
              startsAt,
              link: origin ? `${origin}/candidate/applications` : null,
            });
            await send({ to: profile.data.email, ...message });
          } catch (err) {
            console.error("[booking] confirmation email failed", describeError(err));
          }
        });
      },
    });
  } catch (err) {
    console.error("[booking] unhandled error", describeError(err));
    return jsonResponse(500, { success: false, error: "internal_error", message: "Internal error." });
  }
}
