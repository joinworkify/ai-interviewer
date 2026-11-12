import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static checks for 20261112000004_ai_security_hardening.sql (no database).
 * The behavioural proof is tests/db/forgery.test.ts; this guards the file's
 * shape so it stays safe to apply in any order next to other branches'
 * migrations.
 */

const FILE = fileURLToPath(
  new URL(
    "../supabase/migrations/20261112000004_ai_security_hardening.sql",
    import.meta.url,
  ),
);

const raw = readFileSync(FILE, "utf8");
const sql = raw
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("ai security hardening migration", () => {
  it("revokes browser writes on sessions and feedback, guarded by to_regclass", () => {
    expect(sql).toMatch(/to_regclass\('public\.interview_sessions'\)/);
    expect(sql).toMatch(
      /revoke insert, update, delete on table public\.interview_sessions from anon, authenticated/,
    );
    expect(sql).toMatch(/to_regclass\('public\.feedback'\)/);
    expect(sql).toMatch(
      /revoke insert, update, delete on table public\.feedback from anon, authenticated/,
    );
  });

  it("drops the owner write policies with drop policy if exists, and keeps select-own", () => {
    for (const [policy, table] of [
      ["sessions_insert_own", "interview_sessions"],
      ["sessions_update_own", "interview_sessions"],
      ["sessions_delete_own", "interview_sessions"],
      ["feedback_insert_own", "feedback"],
      ["feedback_delete_own", "feedback"],
    ]) {
      expect(sql).toContain(
        `drop policy if exists "${policy}" on public.${table}`,
      );
    }
    expect(sql).not.toMatch(/drop policy if exists "(sessions|feedback)_select_own"/);
    expect(sql).not.toMatch(/create policy/);
  });

  it("never grants anything to browser roles", () => {
    expect(sql).not.toMatch(/\bgrant [^;]*\bto [^;]*\b(anon|authenticated|public)\b/);
  });

  it("never edits applied migrations or alters schema destructively", () => {
    expect(sql).not.toMatch(/drop table|drop column|truncate/);
  });

  it("makes purge_vapi_events service-role only, run as the caller", () => {
    const start = sql.indexOf("create or replace function public.purge_vapi_events");
    expect(start).toBeGreaterThan(-1);
    const bodyStart = sql.indexOf("$$", start);
    const fn = sql.slice(start, sql.indexOf("$$", bodyStart + 2) + 2);
    expect(fn).toMatch(/security invoker/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(sql).toMatch(
      /revoke all on function public\.purge_vapi_events\(uuid, uuid\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.purge_vapi_events\(uuid, uuid\) to service_role/,
    );
  });

  it("corrects the stale table docs with comment on (no edits to applied SQL)", () => {
    for (const t of ["capability_uses", "interviews", "vapi_events", "ai_usage"]) {
      expect(sql).toMatch(new RegExp(`comment on table public\\.${t} is `));
    }
  });
});
