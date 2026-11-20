import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { RoleTask, TaskKind } from "@/lib/tasks/tasks";
import type { Database } from "@/types/database";

/** Admin-side access to role tasks (table role_tasks, service role only). */

/** Tasks per role id, in order. */
export async function loadTasks(db: SupabaseClient<Database>): Promise<Map<string, (RoleTask & { id: string })[]>> {
  const { data, error } = await db.from("role_tasks").select("id, role_id, kind, title, prompt, minutes").order("position", { ascending: true });
  if (error) throw error;
  const out = new Map<string, (RoleTask & { id: string })[]>();
  for (const t of data ?? []) {
    out.set(t.role_id, [...(out.get(t.role_id) ?? []), { id: t.id, kind: t.kind as TaskKind, title: t.title, prompt: t.prompt, minutes: t.minutes }]);
  }
  return out;
}

/**
 * Makes the role's tasks match the list: tasks with an id are updated (so
 * submissions already made to them are kept), tasks without one are added,
 * and tasks missing from the list are deleted (with their submissions).
 */
export async function saveTasks(db: SupabaseClient<Database>, roleId: string, tasks: RoleTask[]): Promise<void> {
  const existing = await db.from("role_tasks").select("id").eq("role_id", roleId);
  if (existing.error) throw existing.error;
  const have = new Set((existing.data ?? []).map((t) => t.id));
  const keep = new Set(tasks.flatMap((t) => (t.id && have.has(t.id) ? [t.id] : [])));

  const remove = [...have].filter((id) => !keep.has(id));
  if (remove.length > 0) {
    const { error } = await db.from("role_tasks").delete().eq("role_id", roleId).in("id", remove);
    if (error) throw error;
  }
  for (const [position, t] of tasks.entries()) {
    const row = { role_id: roleId, kind: t.kind, title: t.title, prompt: t.prompt, minutes: t.minutes, position };
    const { error } =
      t.id && have.has(t.id)
        ? await db.from("role_tasks").update(row).eq("id", t.id).eq("role_id", roleId)
        : await db.from("role_tasks").insert(row);
    if (error) throw error;
  }
}
