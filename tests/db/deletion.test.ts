import { describe, expect, it } from "vitest";

import { dbAvailable, IDS, runSql, SEED_SQL } from "../helpers/psql";

/**
 * Deletion against the real local Postgres: deleting a user must leave no
 * personal rows in any table, and the other user's rows must survive.
 *
 * Tables are discovered from information_schema, so a table added later with a
 * `user_id` column fails here until it is added to KNOWN_USER_TABLES (and its
 * deletion behaviour is decided). `vapi_events` has no user column; it is
 * handled by purge_vapi_events and checked separately.
 *
 * Needs the local container and the 20261112000004 migration applied.
 */

const HAS_DB = dbAvailable();
const A = IDS.userA;
const B = IDS.userB;

/** Every public table that holds rows keyed by user_id, and how it is deleted. */
const KNOWN_USER_TABLES = [
  "ai_usage", // cascade from profiles (see docs/security-ai-data.md)
  "capability_uses", // cascade from profiles
  "feedback", // cascade from profiles (and from its session)
  "interview_sessions", // cascade from profiles (and from its interview)
  "interviews", // cascade from profiles
];

const EXTRA_SEED = `
insert into public.capability_uses (generation_id, user_id) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', '${A}'),
  ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', '${B}');
insert into public.ai_usage (user_id, feature, model) values
  ('${A}', 'session-feedback', 'm'),
  ('${B}', 'session-feedback', 'm');
insert into public.vapi_events (vapi_call_id, type, payload) values
  ('call-a1', 'end-of-call-report', '{"transcript":"secret-a"}'),
  ('call-a1', 'status-update', '{}'),
  ('call-a2', 'status-update', '{}'),
  ('call-b1', 'end-of-call-report', '{"transcript":"secret-b"}');
`;

function scenario(body: string): string {
  return `begin;\n${SEED_SQL}\n${EXTRA_SEED}\n${body}\nrollback;\n`;
}

/** Counts rows per user in every public table that has a user_id column. */
const COUNT_LEFTOVERS = `
create temp table leftovers (tbl text, who text, n bigint);
do $$
declare t text; who text; n bigint;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
    group by table_name
  loop
    foreach who in array array['${A}', '${B}'] loop
      execute format('select count(*) from public.%I where user_id = %L', t, who) into n;
      insert into leftovers values (t, case when who = '${A}' then 'A' else 'B' end, n);
    end loop;
  end loop;
end $$;
select 'rows:' || tbl || ':' || who || '=' || n from leftovers order by 1;
select 'profiles:A=' || count(*) from public.profiles where id = '${A}';
select 'profiles:B=' || count(*) from public.profiles where id = '${B}';
select 'authusers:A=' || count(*) from auth.users where id = '${A}';
select 'authusers:B=' || count(*) from auth.users where id = '${B}';
select 'vapi:A=' || count(*) from public.vapi_events where vapi_call_id in ('call-a1', 'call-a2');
select 'vapi:B=' || count(*) from public.vapi_events where vapi_call_id = 'call-b1';
`;

function parse(stdout: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of stdout.split("\n")) {
    const m = /^([^=]+)=(\d+)$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

describe.skipIf(!HAS_DB)("deleting user data", () => {
  it("leaves no personal rows for the deleted user in any table, and keeps the other user's", () => {
    const r = runSql(
      scenario(`
        set local role service_role;
        select public.purge_vapi_events('${A}');
        reset role;
        delete from auth.users where id = '${A}';
        ${COUNT_LEFTOVERS}
      `),
    );
    expect(r.stderr).toBe("");
    expect(r.ok).toBe(true);
    const counts = parse(r.stdout);

    const discovered = [
      ...new Set(
        Object.keys(counts)
          .filter((k) => k.startsWith("rows:"))
          .map((k) => k.split(":")[1]),
      ),
    ].sort();
    // A new table with a user_id column must be mapped, with a deletion decision.
    expect(discovered).toEqual(KNOWN_USER_TABLES);

    for (const table of KNOWN_USER_TABLES) {
      expect(counts[`rows:${table}:A`], `${table} rows left for the deleted user`).toBe(0);
      expect(counts[`rows:${table}:B`], `${table} rows of the other user`).toBeGreaterThan(0);
    }
    expect(counts["profiles:A"]).toBe(0);
    expect(counts["authusers:A"]).toBe(0);
    expect(counts["vapi:A"]).toBe(0);
    expect(counts["profiles:B"]).toBe(1);
    expect(counts["authusers:B"]).toBe(1);
    expect(counts["vapi:B"]).toBe(1);
  });

  it("would leave vapi_events behind without the purge (why purge_vapi_events exists)", () => {
    const r = runSql(scenario(`delete from auth.users where id = '${A}';\n${COUNT_LEFTOVERS}`));
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)["vapi:A"]).toBe(3);
  });

  it("purges only one session's events when given a session id", () => {
    const r = runSql(
      scenario(`
        set local role service_role;
        select 'purged=' || public.purge_vapi_events('${A}', '${IDS.sessionA}');
        reset role;
        select 'call-a1=' || count(*) from public.vapi_events where vapi_call_id = 'call-a1';
        select 'call-a2=' || count(*) from public.vapi_events where vapi_call_id = 'call-a2';
        select 'call-b1=' || count(*) from public.vapi_events where vapi_call_id = 'call-b1';
      `),
    );
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ purged: 2, "call-a1": 0, "call-a2": 1, "call-b1": 1 });
  });

  it("never purges another user's events, even when handed their session id", () => {
    const r = runSql(
      scenario(`
        set local role service_role;
        select 'purged=' || public.purge_vapi_events('${A}', '${IDS.sessionB}');
        reset role;
        select 'call-b1=' || count(*) from public.vapi_events where vapi_call_id = 'call-b1';
      `),
    );
    expect(parse(r.stdout)).toEqual({ purged: 0, "call-b1": 1 });
  });

  it("is not callable by browsers", () => {
    const r = runSql(
      scenario(`
        set local role authenticated;
        select public.purge_vapi_events('${A}');
      `),
    );
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/permission denied for function purge_vapi_events/);
  });

  it("deleting a session cascades to its feedback only", () => {
    const r = runSql(
      scenario(`
        set local role service_role;
        delete from public.interview_sessions where id = '${IDS.sessionA}' and user_id = '${A}';
        select 'fbA=' || count(*) from public.feedback where session_id = '${IDS.sessionA}';
        select 'fbB=' || count(*) from public.feedback where session_id = '${IDS.sessionB}';
        select 'sessA2=' || count(*) from public.interview_sessions where id = '${IDS.sessionA2}';
      `),
    );
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ fbA: 0, fbB: 1, sessA2: 1 });
  });

  it("clearing a transcript keeps the session and its feedback", () => {
    const r = runSql(
      scenario(`
        set local role service_role;
        update public.interview_sessions set transcript = null, recording_url = null
          where id = '${IDS.sessionA}' and user_id = '${A}';
        select 'fbA=' || count(*) from public.feedback where session_id = '${IDS.sessionA}';
        select 'transcriptNull=' || count(*) from public.interview_sessions
          where id = '${IDS.sessionA}' and transcript is null and recording_url is null;
      `),
    );
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ fbA: 1, transcriptNull: 1 });
  });

  it("deleting an interview does not free its capability token (no FK to interviews)", () => {
    const r = runSql(
      scenario(`
        delete from public.interviews where id = '${IDS.interviewA}';
        select 'tokens=' || count(*) from public.capability_uses where user_id = '${A}';
        select 'sessions=' || count(*) from public.interview_sessions where interview_id = '${IDS.interviewA}';
      `),
    );
    expect(r.ok).toBe(true);
    expect(parse(r.stdout)).toEqual({ tokens: 1, sessions: 0 });
  });
});
