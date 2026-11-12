import { describe, expect, it } from "vitest";

import {
  asAuthenticated,
  asServiceRole,
  dbAvailable,
  IDS,
  runSql,
} from "../helpers/psql";

/**
 * Forgery tests against the real local Postgres. They run as the
 * `authenticated` role, which is what PostgREST uses for a signed-in browser,
 * so a passing "denied" case means the browser cannot do it.
 *
 * Needs the local Supabase container and the 20261112000004 migration applied
 * (`npm run supabase:start && npx supabase migration up`). Skipped otherwise.
 */

const HAS_DB = dbAvailable();

/** Not a Postgres error code, so a failed seed cannot pass as "denied". */
const DENIED = /permission denied for table/;

describe.skipIf(!HAS_DB)("browser cannot forge sessions or feedback", () => {
  const A = IDS.userA;

  describe.each([
    [
      "update transcript",
      `update public.interview_sessions set transcript = '[{"role":"user","text":"forged"}]' where id = '${IDS.sessionA}';`,
    ],
    [
      "update status",
      `update public.interview_sessions set status = 'completed' where id = '${IDS.sessionA2}';`,
    ],
    [
      "re-point interview_id at another user's interview",
      `update public.interview_sessions set interview_id = '${IDS.interviewB}' where id = '${IDS.sessionA}';`,
    ],
    [
      "update recording_url",
      `update public.interview_sessions set recording_url = 'https://evil.example' where id = '${IDS.sessionA}';`,
    ],
    [
      "insert a session",
      `insert into public.interview_sessions (interview_id, user_id, status, transcript) values ('${IDS.interviewA}', '${A}', 'completed', '[]');`,
    ],
    [
      "insert feedback with a perfect score",
      `insert into public.feedback (session_id, user_id, total_score, final_assessment) values ('${IDS.sessionA2}', '${A}', 100, 'forged');`,
    ],
    [
      "delete own feedback (re-opens the session for another evaluation)",
      `delete from public.feedback where id = '${IDS.feedbackA}';`,
    ],
    [
      "delete own session",
      `delete from public.interview_sessions where id = '${IDS.sessionA}';`,
    ],
    [
      "insert an interview",
      `insert into public.interviews (user_id, questions) values ('${A}', '{"forged"}');`,
    ],
    [
      "insert ai_usage (would reset the quota)",
      `insert into public.ai_usage (user_id, feature, model) values ('${A}', 'x', 'y');`,
    ],
    [
      "delete ai_usage",
      `delete from public.ai_usage where user_id = '${A}';`,
    ],
  ])("denies: %s", (_name, statement) => {
    it("fails with permission denied", () => {
      const r = runSql(asAuthenticated(A, statement));
      expect(r.stderr).toMatch(DENIED);
      expect(r.ok).toBe(false);
    });
  });

  it("still lets a user read only their own sessions and feedback", () => {
    const r = runSql(
      asAuthenticated(
        A,
        `select 'own_sessions=' || count(*) from public.interview_sessions where user_id = '${A}';
         select 'other_sessions=' || count(*) from public.interview_sessions where user_id = '${IDS.userB}';
         select 'own_feedback=' || count(*) from public.feedback where user_id = '${A}';
         select 'other_feedback=' || count(*) from public.feedback where user_id = '${IDS.userB}';`,
      ),
    );
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain("own_sessions=2");
    expect(r.stdout).toContain("other_sessions=0");
    expect(r.stdout).toContain("own_feedback=1");
    expect(r.stdout).toContain("other_feedback=0");
  });

  it("keeps the server (service role) able to write", () => {
    const r = runSql(
      asServiceRole(
        `update public.interview_sessions set status = 'completed' where id = '${IDS.sessionA2}';
         insert into public.feedback (session_id, user_id, total_score) values ('${IDS.sessionA2}', '${A}', 70);
         delete from public.feedback where id = '${IDS.feedbackA}';`,
      ),
    );
    expect(r.stderr).toBe("");
    expect(r.ok).toBe(true);
  });

  it("leaves no insert/update/delete privilege or policy for browsers", () => {
    const r = runSql(`
      select 'grant=' || table_name || ':' || privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('interview_sessions', 'feedback')
        and grantee in ('authenticated', 'anon', 'public')
        and privilege_type <> 'SELECT';
      select 'policy=' || tablename || ':' || policyname || ':' || cmd
      from pg_policies
      where schemaname = 'public'
        and tablename in ('interview_sessions', 'feedback')
        and cmd <> 'SELECT';
    `);
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("");
  });
});
