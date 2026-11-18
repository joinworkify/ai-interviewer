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
const OTHER_USER = "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0";
const ADMIN_USER = "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";

// Counted by the seed's own ids, so rows a developer added to a local database
// by hand do not change the result.
const SEED_USERS = `'${DEV_USER}', '${OTHER_USER}', '${ADMIN_USER}'`;
const SEED_IDS = {
  interviews: `'d3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'`,
  sessions: `'dadadada-dada-4dad-8dad-dadadadadada', 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'`,
  feedback: `'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3'`,
  usage: `'d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d3', 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4'`,
};

const COUNTS = `
select 'users=' || count(*) from auth.users where id in (${SEED_USERS});
select 'identities=' || count(*) from auth.identities where user_id in (${SEED_USERS});
select 'profiles=' || count(*) from public.profiles where id in (${SEED_USERS});
select 'interviews=' || count(*) from public.interviews where id in (${SEED_IDS.interviews});
select 'sessions=' || count(*) from public.interview_sessions where id in (${SEED_IDS.sessions});
select 'feedback=' || count(*) from public.feedback where id in (${SEED_IDS.feedback});
select 'usage=' || count(*) from public.ai_usage where id in (${SEED_IDS.usage});
select 'timestampsSet=' || count(*) from auth.users u
  where u.id in (${SEED_USERS}) and u.created_at is not null and u.updated_at is not null
    and exists (select 1 from auth.identities i where i.user_id = u.id
                and i.created_at is not null and i.updated_at is not null);
select 'passwordOk=' || count(*) from auth.users
  where id in (${SEED_USERS}) and encrypted_password = crypt('test123!', encrypted_password);
select 'adminRole=' || count(*) from auth.users
  where id = '${ADMIN_USER}' and raw_app_meta_data ->> 'role' = 'admin';
`;

function parse(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of stdout.split("\n")) {
    const m = /^(\w+)=(\d+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

// Two candidate rows per table plus the admin auth user and profile.
const EXPECTED = {
  users: 3,
  identities: 3,
  profiles: 3,
  interviews: 2,
  sessions: 2,
  feedback: 2,
  usage: 2,
  timestampsSet: 3,
  passwordOk: 3,
  adminRole: 1,
};

describe("seed.sql file", () => {
  it("has no transaction control and never touches schema", () => {
    const sql = SEED
      // Dollar-quoted values ($t$...$t$, used for jsonb) first: they hold
      // apostrophes and "--" that would break the passes below.
      .replace(/(\$\w*\$)[\s\S]*?\1/g, "''")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n")
      // String values (e.g. role text "Create RL Environments") are data, not statements.
      .replace(/'(?:[^']|'')*'/g, "''")
      .toLowerCase();
    expect(sql).not.toMatch(/\b(begin|commit|rollback)\b\s*;/);
    expect(sql).not.toMatch(
      /\b(create|alter|drop|truncate)\s+(or\s+replace\s+)?(table|schema|index|function|trigger|policy|type|extension)\b/,
    );
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
select 'ownSeedSessions=' || count(*) from public.interview_sessions where id in (${SEED_IDS.sessions});
select 'ownSeedFeedback=' || count(*) from public.feedback where id in (${SEED_IDS.feedback});
select 'otherUsersRows=' || (
  (select count(*) from public.interview_sessions where user_id = '${OTHER_USER}') +
  (select count(*) from public.feedback where user_id = '${OTHER_USER}') +
  (select count(*) from public.interviews where user_id = '${OTHER_USER}')
);
rollback;`);
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ ownSeedSessions: 1, ownSeedFeedback: 1, otherUsersRows: 0 });
  });

  it("gives each user one completed Gemini Live session with feedback", () => {
    const r = runSql(`begin;
${SEED}
select 'completedGemini=' || count(*) from public.interview_sessions s
  where s.id in (${SEED_IDS.sessions}) and s.status = 'completed'
    and s.transcript_source = 'client_gemini_live' and jsonb_array_length(s.transcript) > 0
    and exists (select 1 from public.feedback f where f.session_id = s.id and f.user_id = s.user_id);
rollback;`);
    expect(r.stderr).toBe("");
    expect(parse(r.stdout)).toEqual({ completedGemini: 2 });
  });
});
