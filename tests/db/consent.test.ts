import { describe, expect, it } from "vitest";

import { asAuthenticated, asServiceRole, dbAvailable, IDS, runSql } from "../helpers/psql";

/**
 * candidate_consents against the real local Postgres: owner-only reads, no
 * browser writes, one row per session, and cascades. Needs the local
 * container with 20261113000000 applied (`npx supabase migration up`).
 */

const HAS_DB = dbAvailable();
const A = IDS.userA;
const B = IDS.userB;

const INSERT = `insert into public.candidate_consents (user_id, session_id, role_id, consent_version) values
  ('${A}', '${IDS.sessionA}', 'generalist', '2026-11-13'),
  ('${B}', '${IDS.sessionB}', 'generalist', '2026-11-13');`;

describe.skipIf(!HAS_DB)("candidate_consents", () => {
  it("lets the service role insert and a user read only their own row", () => {
    const sql = asServiceRole(`${INSERT}
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${A}","role":"authenticated"}', true);
select 'visible=' || count(*) from public.candidate_consents;
select 'others=' || count(*) from public.candidate_consents where user_id = '${B}';`);
    const r = runSql(sql);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("visible=1");
    expect(r.stdout).toContain("others=0");
  });

  it("refuses browser inserts, updates and deletes", () => {
    for (const stmt of [
      `insert into public.candidate_consents (user_id, session_id, role_id, consent_version)
         values ('${A}', '${IDS.sessionA2}', 'generalist', 'v1')`,
      `update public.candidate_consents set consent_version = 'x'`,
      `delete from public.candidate_consents`,
    ]) {
      const r = runSql(asAuthenticated(A, `${stmt};`));
      expect(r.ok, stmt).toBe(false);
      expect(r.stderr, stmt).toMatch(/permission denied/i);
    }
  });

  it("allows one consent per session", () => {
    const r = runSql(
      asServiceRole(`${INSERT}
insert into public.candidate_consents (user_id, session_id, role_id, consent_version)
  values ('${A}', '${IDS.sessionA}', 'generalist', 'v2');`),
    );
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/duplicate key|unique/i);
  });

  it("rejects blank or overlong values", () => {
    for (const [role, version] of [["", "v1"], ["generalist", ""], ["x".repeat(81), "v1"], ["generalist", "v".repeat(41)]]) {
      const r = runSql(
        asServiceRole(`insert into public.candidate_consents (user_id, session_id, role_id, consent_version)
  values ('${A}', '${IDS.sessionA}', '${role}', '${version}');`),
      );
      expect(r.ok, `${role.length}/${version.length}`).toBe(false);
      expect(r.stderr).toMatch(/check constraint/i);
    }
  });

  it("goes away with its session", () => {
    const r = runSql(
      asServiceRole(`${INSERT}
delete from public.interview_sessions where id = '${IDS.sessionA}';
select 'left=' || count(*) from public.candidate_consents where user_id = '${A}';
select 'other=' || count(*) from public.candidate_consents where user_id = '${B}';`),
    );
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("left=0");
    expect(r.stdout).toContain("other=1");
  });
});
