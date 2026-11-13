import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Static checks (SQL text, no database) for the consent table migration. */

const FILE = fileURLToPath(
  new URL("../supabase/migrations/20261113000000_candidate_consents.sql", import.meta.url),
);
const sql = readFileSync(FILE, "utf8")
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();

describe("candidate_consents migration", () => {
  it("creates the table only if missing, with one row per session that follows its owner and session", () => {
    expect(sql).toContain("create table if not exists public.candidate_consents");
    expect(sql).toContain("user_id uuid not null references public.profiles (id) on delete cascade");
    expect(sql).toContain(
      "session_id uuid not null unique references public.interview_sessions (id) on delete cascade",
    );
  });

  it("turns row level security on and lets browsers only read their own rows", () => {
    expect(sql).toContain("alter table public.candidate_consents enable row level security");
    expect(sql).toContain("revoke all on table public.candidate_consents from anon, authenticated");
    expect(sql).toContain("grant select on table public.candidate_consents to authenticated");
    expect(sql).toContain("grant all on table public.candidate_consents to service_role");
    expect(sql).toContain("using (user_id = (select auth.uid()))");
    expect(sql).not.toMatch(/grant [a-z, ]*(insert|update|delete)[a-z, ]* on table public\.candidate_consents to (authenticated|anon)/);
  });

  it("can run twice", () => {
    expect(sql).toContain("drop policy if exists");
    expect(sql).toContain("create index if not exists");
    expect(sql).not.toMatch(/\bcreate table (?!if not exists)/);
  });
});
