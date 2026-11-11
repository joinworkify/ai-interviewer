import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static regression checks for the interviews migration's privilege surface.
 *
 * Each `interviews` row is also the single-use record for its capability
 * token (`generation_id`). If browsers could DELETE their rows, an unexpired
 * token could be replayed to trigger another paid LLM call. These tests make
 * sure the migration only lets `authenticated` SELECT its own rows and gives
 * `anon`/`authenticated` no write privileges or write policies at all.
 *
 * This parses SQL text (no database is available in unit tests), so it guards
 * against regressions in this file, not against out-of-band dashboard edits.
 */

const MIGRATION = fileURLToPath(
  new URL(
    "../supabase/migrations/20261109000000_create_interviews.sql",
    import.meta.url,
  ),
);

/** Migration SQL with `--` comments removed and whitespace collapsed. */
function loadSql(): string {
  return readFileSync(MIGRATION, "utf8")
    .split(/\r?\n/) // Windows checkouts use CRLF
    .map((line) => line.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const sql = loadSql();
const stmts = statements(sql);
const BROWSER_ROLES = /\b(anon|authenticated|public)\b/;

describe("interviews migration privileges", () => {
  it("enables row level security", () => {
    expect(sql).toMatch(
      /alter table public\.interviews enable row level security/,
    );
  });

  it("revokes all browser-role privileges before granting", () => {
    const revokeIdx = stmts.findIndex((s) =>
      /^revoke all on table public\.interviews from anon, authenticated$/.test(s),
    );
    const firstGrantIdx = stmts.findIndex((s) => /^grant /.test(s));
    expect(revokeIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeLessThan(firstGrantIdx);
  });

  it("grants authenticated SELECT only, and anon nothing", () => {
    const browserGrants = stmts.filter(
      (s) => /^grant /.test(s) && / to .*\b(anon|authenticated|public)\b/.test(s),
    );
    expect(browserGrants).toEqual([
      "grant select on table public.interviews to authenticated",
    ]);
  });

  it("defines exactly one policy: owner-scoped SELECT for authenticated", () => {
    const policies = stmts.filter((s) => /^create policy /.test(s));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/ for select /);
    expect(policies[0]).toMatch(/ to authenticated /);
    expect(policies[0]).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)$/);
  });

  it("has no DELETE/INSERT/UPDATE/ALL policy or grant for browser roles", () => {
    for (const s of stmts) {
      if (/^create policy /.test(s)) {
        expect(s).not.toMatch(/ for (delete|insert|update|all) /);
      }
      if (/^grant /.test(s) && BROWSER_ROLES.test(s.split(" to ")[1] ?? "")) {
        expect(s).not.toMatch(/\b(delete|insert|update|all|truncate)\b/);
      }
    }
  });
});
