import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { NotifyStore } from "./review-notify";

const PG_UNIQUE_VIOLATION = "23505";

function fail(op: string, error: { code?: string } | null): never {
  // Op name and Postgres code only: messages can quote row values.
  console.error(`[notify-store] ${op} failed`, error?.code ?? "");
  throw new Error(`${op} failed`);
}

/** Needs the service-role client: the notification table has no browser access. */
export function createSupabaseNotifyStore(db: SupabaseClient<Database>): NotifyStore {
  return {
    async load(sessionId) {
      const session = await db.from("interview_sessions").select("user_id").eq("id", sessionId).maybeSingle();
      if (session.error) fail("load session", session.error);
      if (!session.data) return null;
      const [profile, consent] = await Promise.all([
        db.from("profiles").select("name, email").eq("id", session.data.user_id).maybeSingle(),
        db.from("candidate_consents").select("role_id").eq("session_id", sessionId).maybeSingle(),
      ]);
      if (profile.error) fail("load profile", profile.error);
      if (consent.error) fail("load consent", consent.error);
      if (!profile.data?.email) return null;
      let roleTitle: string | null = null;
      if (consent.data?.role_id) {
        const role = await db.from("roles").select("title").eq("id", consent.data.role_id).maybeSingle();
        if (role.error) fail("load role", role.error);
        roleTitle = role.data?.title ?? null;
      }
      return { userId: session.data.user_id, email: profile.data.email, name: profile.data.name, roleTitle };
    },

    async claim(sessionId, stage) {
      const { error } = await db.from("candidate_notifications").insert({ session_id: sessionId, stage });
      if (!error) return true;
      if (error.code === PG_UNIQUE_VIOLATION) return false;
      return fail("claim", error);
    },

    async release(sessionId, stage) {
      const { error } = await db
        .from("candidate_notifications")
        .delete()
        .eq("session_id", sessionId)
        .eq("stage", stage);
      if (error) fail("release", error);
    },
  };
}
