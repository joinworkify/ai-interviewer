import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseRubric, type RubricCriterion } from "@/lib/evaluation/rubric";
import type { Database, Json } from "@/types/database";

/**
 * Admin-side access to role rubrics (table role_rubrics, service role only).
 * Kept apart from the public roles table so candidates can never read how
 * they are scored.
 */

/** Rubric per role id; roles with none (or an unreadable one) map to []. */
export async function loadRubrics(db: SupabaseClient<Database>): Promise<Map<string, RubricCriterion[]>> {
  const { data, error } = await db.from("role_rubrics").select("role_id, criteria");
  if (error) throw error;
  const out = new Map<string, RubricCriterion[]>();
  for (const row of data ?? []) {
    const parsed = parseRubric(row.criteria);
    out.set(row.role_id, parsed.ok ? parsed.rubric : []);
  }
  return out;
}

/** Saves a role's rubric; an empty rubric removes the row (default rubric applies). */
export async function saveRubric(
  db: SupabaseClient<Database>,
  roleId: string,
  rubric: RubricCriterion[],
): Promise<void> {
  if (rubric.length === 0) {
    const { error } = await db.from("role_rubrics").delete().eq("role_id", roleId);
    if (error) throw error;
    return;
  }
  const { error } = await db.from("role_rubrics").upsert({
    role_id: roleId,
    criteria: rubric as unknown as Json,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
