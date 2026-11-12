import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Recording stand-in for the Supabase query builder (no network). It records
 * each query with its filters, and the order of every call in `events`, so
 * tests can assert "every query is scoped to the user" and "purge runs before
 * delete".
 */

export interface Recorded {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Record<string, unknown>;
}

export type Reply = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

export interface FakeOptions {
  rpc?: (name: string, args: Record<string, unknown>) => Reply;
  deleteUser?: (id: string) => { error: { message: string } | null };
}

export function fakeClient(
  replies: (q: Recorded) => Reply,
  options: FakeOptions = {},
) {
  const log: Recorded[] = [];
  const events: string[] = [];
  const client = {
    from(table: string) {
      const q: Recorded = { table, op: "select", filters: {} };
      const builder = {
        select() {
          return builder;
        },
        insert(payload: unknown) {
          q.op = "insert";
          q.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          q.op = "update";
          q.payload = payload;
          return builder;
        },
        delete() {
          q.op = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          q.filters[column] = value;
          return builder;
        },
        maybeSingle: async () => run(),
        single: async () => run(),
        then(resolve: (r: Reply) => unknown, reject?: (e: unknown) => unknown) {
          return run().then(resolve, reject);
        },
      };
      async function run(): Promise<Reply> {
        log.push(q);
        events.push(`${table}:${q.op}`);
        return replies(q);
      }
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      events.push(`rpc:${name}`);
      log.push({ table: `rpc:${name}`, op: "select", payload: args, filters: {} });
      return options.rpc ? options.rpc(name, args) : { data: 0, error: null };
    },
    auth: {
      admin: {
        async deleteUser(id: string) {
          events.push("auth.deleteUser");
          log.push({ table: "auth.users", op: "delete", filters: { id } });
          return options.deleteUser ? options.deleteUser(id) : { data: {}, error: null };
        },
      },
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, log, events };
}
