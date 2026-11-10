import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static checks for the AI backend migration's privilege surface. Parses SQL
 * text (no database in unit tests), so it guards this file against
 * regressions, not out-of-band dashboard edits.
 */

const FILE = fileURLToPath(
  new URL("../supabase/migrations/20261109000002_ai_backend.sql", import.meta.url),
);

const sql = readFileSync(FILE, "utf8")
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();
const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
const BROWSER = /\b(anon|authenticated|public)\b/;

describe("capability_uses (single-use token record)", () => {
  it("is keyed by generation_id with RLS on", () => {
    expect(sql).toMatch(/create table if not exists public\.capability_uses \( generation_id uuid primary key/);
    expect(sql).toMatch(/alter table public\.capability_uses enable row level security/);
  });

  it("gives browsers no privileges and defines no policy, so tokens cannot be un-used", () => {
    expect(stmts).toContain("revoke all on table public.capability_uses from anon, authenticated");
    for (const s of stmts) {
      if (/^grant /.test(s) && /public\.capability_uses/.test(s)) {
        expect(s).toMatch(/ to service_role$/);
      }
      if (/^create policy /.test(s)) expect(s).not.toMatch(/capability_uses/);
    }
  });
});

describe("save_generated_interview", () => {
  // The body contains semicolons, so slice the whole definition (through the
  // closing $$) out of the SQL instead of using the statement splitter.
  const start = sql.indexOf("create or replace function public.save_generated_interview");
  const bodyStart = sql.indexOf("$$", start);
  const fn = sql.slice(start, sql.indexOf("$$", bodyStart + 2) + 2);

  it("claims the token before inserting the interview, in one function", () => {
    expect(fn).toBeDefined();
    const claim = fn.indexOf("insert into public.capability_uses");
    const insert = fn.indexOf("insert into public.interviews");
    expect(claim).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(claim);
  });

  it("runs as the caller with an empty search_path", () => {
    expect(fn).toMatch(/security invoker/);
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn).not.toMatch(/security definer/);
  });

  it("is executable by the service role only", () => {
    const revoke = stmts.find((s) => /^revoke all on function public\.save_generated_interview/.test(s))!;
    expect(revoke).toMatch(/from public, anon, authenticated$/);
    const grants = stmts.filter((s) => /^grant execute on function public\.save_generated_interview/.test(s));
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/ to service_role$/);
  });
});

describe("ai_usage", () => {
  it("lets users read only their own rows and write nothing", () => {
    expect(sql).toMatch(/alter table public\.ai_usage enable row level security/);
    const browserGrants = stmts.filter(
      (s) => /^grant /.test(s) && /public\.ai_usage/.test(s) && BROWSER.test(s.split(" to ")[1] ?? ""),
    );
    expect(browserGrants).toEqual(["grant select on table public.ai_usage to authenticated"]);

    const policies = stmts.filter((s) => /^create policy /.test(s) && /public\.ai_usage/.test(s));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/ for select /);
    expect(policies[0]).toMatch(/using \(user_id = \(select auth\.uid\(\)\)\)$/);
  });
});

describe("feedback", () => {
  it("allows at most one feedback row per session", () => {
    expect(sql).toMatch(/create unique index if not exists feedback_session_id_key on public\.feedback \(session_id\)/);
  });
});
