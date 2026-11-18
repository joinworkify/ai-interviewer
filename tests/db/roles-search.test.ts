import { describe, expect, it } from "vitest";

import { dbAvailable, runSql } from "../helpers/psql";

/**
 * search_roles against the real local Postgres: anon can run it, and it
 * matches active roles by title or skill without returning inactive ones.
 * Needs the local container with 20261118000000 applied.
 */

const HAS_DB = dbAvailable();

const FIXTURE = `
insert into public.roles (id, title, pay_min, pay_max, pay_type, job_type, skills, is_active, sort_order) values
  ('db-search-second', 'Second Search Role', 2, 3, 'hour', 'Contractor', array['PostgreSQL'], true, 2),
  ('db-search-first', 'First Search Role', 1, 2, 'hour', 'Contractor', array['Search'], true, 1),
  ('db-search-hidden', 'Hidden Search Role', 3, 4, 'hour', 'Contractor', array['PostgreSQL'], false, 0)
on conflict (id) do update set
  title = excluded.title,
  skills = excluded.skills,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;
`;

/** Runs `body` as anon, inside a transaction that is always rolled back. */
const asAnon = (body: string) => `
begin;
${FIXTURE}
set local role anon;
${body}
rollback;
`;

describe.skipIf(!HAS_DB)("search_roles", () => {
  it("lets anon search active roles by title, case-insensitively", () => {
    const r = runSql(
      asAnon(
        `select 'ids=' || string_agg(id, ',') from public.search_roles('SEARCH ROLE');`,
      ),
    );
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("ids=db-search-first,db-search-second");
  });

  it("matches skills but never returns an inactive role", () => {
    const r = runSql(
      asAnon(
        `select 'ids=' || string_agg(id, ',') from public.search_roles('postgres');`,
      ),
    );
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("ids=db-search-second");
  });

  it("returns every active role in display order for a blank query", () => {
    const r = runSql(
      asAnon(`
        select 'order=' || array_agg(id)::text
          from public.search_roles('   ')
          where id like 'db-search-%';
        select 'hidden=' || count(*)
          from public.search_roles('')
          where id = 'db-search-hidden';
      `),
    );
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("order={db-search-first,db-search-second}");
    expect(r.stdout).toContain("hidden=0");
  });
});
