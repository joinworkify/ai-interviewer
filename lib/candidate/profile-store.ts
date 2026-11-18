import type { SupabaseClient } from "@supabase/supabase-js";

import { describeError } from "@/lib/log/safe-error";
import type { Database } from "@/types/database";

import type { ProfileStore } from "./profile";

/**
 * Takes the service-role client like the other candidate stores, so the write
 * is pinned to the user id the route verified from the JWT claims.
 */
export function createSupabaseProfileStore(client: SupabaseClient<Database>): ProfileStore {
  return {
    async update(userId, fields) {
      const patch: Database["public"]["Tables"]["profiles"]["Update"] = {};
      if (fields.name !== undefined) patch.name = fields.name;
      if (fields.phone !== undefined) patch.phone = fields.phone;
      if (fields.linkedinUrl !== undefined) patch.linkedin_url = fields.linkedinUrl;
      if (fields.portfolioUrl !== undefined) patch.portfolio_url = fields.portfolioUrl;

      const { data, error } = await client
        .from("profiles")
        .update(patch)
        .eq("id", userId)
        .select("id");
      if (error) {
        console.error("[candidate-profile] update failed:", describeError(error));
        throw new Error("update failed");
      }
      return (data?.length ?? 0) > 0;
    },
  };
}
