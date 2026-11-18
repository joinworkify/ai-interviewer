import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static checks for the roles table and its seed. Parses SQL text (no database
 * in unit tests), so it guards these files, not out-of-band dashboard edits.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const normalize = (path: string) =>
  read(path)
    .split(/\r?\n/) // Windows checkouts use CRLF
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

const sql = normalize("../supabase/migrations/20261111000000_candidate_roles.sql");
const stmts = sql
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

describe("roles migration", () => {
  it("creates public.roles with RLS on", () => {
    expect(sql).toMatch(/create table if not exists public\.roles \( id text primary key/);
    expect(sql).toMatch(/alter table public\.roles enable row level security/);
  });

  it("lets browsers only read active roles", () => {
    expect(stmts).toContain("revoke all on table public.roles from anon, authenticated");
    expect(stmts).toContain("grant select on table public.roles to anon, authenticated");
    for (const s of stmts) {
      if (/^grant /.test(s) && / to (anon|authenticated)/.test(s))
        expect(s).toMatch(/^grant select /);
      if (/^create policy /.test(s)) {
        expect(s).toMatch(/for select to anon, authenticated using \(is_active\)$/);
      }
    }
  });

  it("is purely additive", () => {
    expect(sql).not.toMatch(/\b(drop table|drop column|alter table public\.(?!roles\b))/);
  });
});

describe("roles search migration", () => {
  const searchSql = normalize("../supabase/migrations/20261118000000_roles_search.sql");

  it("searches as the caller, with RLS in force", () => {
    expect(searchSql).toMatch(/create or replace function public\.search_roles\(p_query text\)/);
    expect(searchSql).toMatch(/security invoker/);
    expect(searchSql).toMatch(/set search_path = ''/);
    expect(searchSql).not.toMatch(/security definer/);
  });

  it("grants execute to browsers and the service role only", () => {
    expect(searchSql).toMatch(
      /revoke all on function public\.search_roles\(text\) from public, anon, authenticated/,
    );
    expect(searchSql).toMatch(
      /grant execute on function public\.search_roles\(text\) to anon, authenticated, service_role/,
    );
  });

  it("matches title and skills, case-insensitively, for active roles", () => {
    expect(searchSql).toMatch(/where is_active/);
    expect(searchSql).toMatch(/strpos\(lower\(title\), lower\(trim\(p_query\)\)\)/);
    expect(searchSql).toMatch(/unnest\(skills\) as skill/);
    expect(searchSql).toMatch(/order by sort_order, title/);
  });
});

describe("roles seed", () => {
  const all = read("../supabase/seed.sql");
  const seed = all.slice(
    all.indexOf("-- BEGIN candidate roles"),
    all.indexOf("-- END candidate roles"),
  );
  const rows = [
    ...seed.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*([\d.]+),\s*([\d.]+),\s*'(hour|task)'/g),
  ].map(([, id, title, min, max, type]) => ({
    id,
    title,
    payMin: Number(min),
    payMax: Number(max),
    payType: type,
  }));

  it("seeds candidate roles", () => {
    expect(rows).toHaveLength(16);
  });

  it("can be re-run without duplicates", () => {
    expect(seed).toMatch(/on conflict \(id\) do update set/);
  });
});
