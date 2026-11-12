import { execFileSync } from "node:child_process";

/**
 * Runs SQL against the local Supabase Postgres container with `psql`, so DB
 * tests exercise the real grants, policies and cascades. There is no pg client
 * in this repo; the container is the dependency.
 *
 * Tests that use this are skipped when the container is not running. Start it
 * with `npm run supabase:start` and apply migrations with
 * `npx supabase migration up`. Override the container name with
 * SUPABASE_DB_CONTAINER.
 */

const CONTAINER =
  process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ai-interviewer";

export interface SqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runSql(sql: string): SqlResult {
  try {
    const stdout = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-U",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-X",
        "-At",
      ],
      { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 },
    );
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      ok: false,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

export function dbAvailable(): boolean {
  try {
    execFileSync(
      "docker",
      ["exec", CONTAINER, "psql", "-U", "postgres", "-X", "-Atc", "select 1"],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** Fixed ids so seed rows are easy to assert on. */
export const IDS = {
  userA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  interviewA: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  interviewB: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  sessionA: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  /** A second session of user A with no feedback yet. */
  sessionA2: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3",
  sessionB: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  feedbackA: "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4",
  feedbackB: "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4",
} as const;

/** Two users, each with an interview, sessions and feedback. */
export const SEED_SQL = `
insert into auth.users (id, email) values
  ('${IDS.userA}', 'a@example.test'),
  ('${IDS.userB}', 'b@example.test');
insert into public.interviews (id, user_id, questions) values
  ('${IDS.interviewA}', '${IDS.userA}', '{"Q1","Q2"}'),
  ('${IDS.interviewB}', '${IDS.userB}', '{"Q1"}');
insert into public.interview_sessions (id, interview_id, user_id, vapi_call_id, transcript, recording_url) values
  ('${IDS.sessionA}',  '${IDS.interviewA}', '${IDS.userA}', 'call-a1', '[{"role":"user","text":"secret-a"}]', 'https://rec.example.test/a1'),
  ('${IDS.sessionA2}', '${IDS.interviewA}', '${IDS.userA}', 'call-a2', null, null),
  ('${IDS.sessionB}',  '${IDS.interviewB}', '${IDS.userB}', 'call-b1', '[{"role":"user","text":"secret-b"}]', null);
insert into public.feedback (id, session_id, user_id, total_score) values
  ('${IDS.feedbackA}', '${IDS.sessionA}', '${IDS.userA}', 40),
  ('${IDS.feedbackB}', '${IDS.sessionB}', '${IDS.userB}', 55);
`;

/** Runs `body` as the authenticated Supabase role for `userId`, in a rolled-back transaction. */
export function asAuthenticated(userId: string, body: string): string {
  return `
begin;
${SEED_SQL}
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);
${body}
rollback;
`;
}

/** Runs `body` as the service role, in a rolled-back transaction. */
export function asServiceRole(body: string): string {
  return `
begin;
${SEED_SQL}
set local role service_role;
${body}
rollback;
`;
}
