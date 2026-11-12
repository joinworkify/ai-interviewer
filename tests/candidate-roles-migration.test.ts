import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import roles from "@/lib/candidate/roles.json";

/**
 * Static checks for the roles table and its seed. Parses SQL text (no database
 * in unit tests), so it guards these files, not out-of-band dashboard edits.
 */

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const sql = read("../supabase/migrations/20261111000000_candidate_roles.sql")
  .split(/\r?\n/) // Windows checkouts use CRLF
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();
const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);

describe("roles migration", () => {
  it("creates public.roles with RLS on", () => {
    expect(sql).toMatch(/create table if not exists public\.roles \( id text primary key/);
    expect(sql).toMatch(/alter table public\.roles enable row level security/);
  });

  it("lets browsers only read active roles", () => {
    expect(stmts).toContain("revoke all on table public.roles from anon, authenticated");
    expect(stmts).toContain("grant select on table public.roles to anon, authenticated");
    for (const s of stmts) {
      if (/^grant /.test(s) && / to (anon|authenticated)/.test(s)) expect(s).toMatch(/^grant select /);
      if (/^create policy /.test(s)) {
        expect(s).toMatch(/for select to anon, authenticated using \(is_active\)$/);
      }
    }
  });

  it("is purely additive", () => {
    expect(sql).not.toMatch(/\b(drop table|drop column|alter table public\.(?!roles\b))/);
  });
});

describe("roles seed", () => {
  // Only the generated roles block; seed.sql also holds other dev data.
  const all = read("../supabase/seed.sql");
  const seed = all.slice(all.indexOf("-- BEGIN candidate roles"), all.indexOf("-- END candidate roles"));
  const rows = [...seed.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)',\s*'([^']+)'/g)].map(
    ([, id, title, payRate]) => ({ id, title, payRate }),
  );

  it("matches lib/candidate/roles.json (regenerate with node scripts/gen-roles-seed.mjs)", () => {
    expect(rows).toEqual(roles.map(({ id, title, payRate }) => ({ id, title, payRate })));
  });

  it("can be re-run without duplicates", () => {
    expect(seed).toMatch(/on conflict \(id\) do update set/);
  });
});
