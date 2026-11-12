import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { dbAvailable, IDS, runSql } from "../helpers/psql";

/**
 * supabase/seed.sql must keep applying after migrations change. These tests run
 * it against the migrated local DB inside a transaction that is rolled back, so
 * nothing persists. When a migration breaks the seed (a renamed or dropped
 * column, a new NOT NULL column), the first test fails and names the statement.
 *
 * Needs the local Supabase container with migrations applied. Skipped otherwise.
 */

const SEED = readFileSync(
  fileURLToPath(new URL("../../supabase/seed.sql", import.meta.url)),
  "utf8",
);
const HAS_DB = dbAvailable();
const DEV_USER = "d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0";

const COUNTS = `
select 'users=' || count(*) from auth.users where id = '${DEV_USER}';
select 'identities=' || count(*) from auth.identities where user_id = '${DEV_USER}';
select 'profiles=' || count(*) from public.profiles where id = '${DEV_USER}';
select 'interviews=' || count(*) from public.interviews where user_id = '${DEV_USER}';
select 'sessions=' || count(*) from public.interview_sessions where user_id = '${DEV_USER}';
select 'feedback=' || count(*) from public.feedback where user_id = '${DEV_USER}';
select 'usage=' || count(*) from public.ai_usage where user_id = '${DEV_USER}';
select 'passwordOk=' || count(*) from auth.users
  where id = '${DEV_USER}' and encrypted_password = crypt('dev-password-local-only', encrypted_password);
`;

function parse(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of stdout.split("\n")) {
    const m = /^(\w+)=(\d+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

const EXPECTED = {
  users: 1,
  identities: 1,
  profiles: 1,
  interviews: 3,
  sessions: 3,
  feedback: 1,
  usage: 3,
  passwordOk: 1,
};

describe("seed.sql file", () => {
  it("has no transaction control and never touches schema", () => {
    const sql = SEED.split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
      // String values (e.g. role text "Create RL Environments") are data, not statements.
      .replace(/'(?:[^']|'')*'/g, "''")
      .toLowerCase();
    expect(sql).not.toMatch(/\b(begin|commit|rollback)\b\s*;/);
    expect(sql).not.toMatch(/\b(create|alter|drop|truncate)\b/);
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
  });

  it("uses only fake example.test emails", () => {
    const emails = SEED.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(e.endsWith("@example.test")).toBe(true);
  });

  it("does not reuse ids from the DB test fixtures", () => {
    for (const id of Object.values(IDS)) expect(SEED).not.toContain(id);
  });
});

describe.skipIf(!HAS_DB)("seed.sql against the migrated local database", () => {
  it("applies without error and creates the expected rows", () => {
    const r = runSql(`begin;\n${SEED}\n${COUNTS}\nrollback;`);
    expect(r.stderr).toBe("");
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual(EXPECTED);
  });

  it("is idempotent: running it twice gives the same rows", () => {
    const r = runSql(`begin;\n${SEED}\n${SEED}\n${COUNTS}\nrollback;`);
    expect(r.stderr).toBe("");
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual(EXPECTED);
  });

  it("seeded sessions and feedback pass the table checks and stay select-only for the user", () => {
    const r = runSql(`begin;
${SEED}
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${DEV_USER}","role":"authenticated"}', true);
select 'ownSessions=' || count(*) from public.interview_sessions;
select 'ownFeedback=' || count(*) from public.feedback;
rollback;`);
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ ownSessions: 3, ownFeedback: 1 });
  });
});
