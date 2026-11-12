import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TRANSCRIPT_SOURCES } from "@/lib/transcripts/types";

/**
 * Static checks (SQL text, no database) for the migration that lets Dograh
 * save transcripts. The real-database check is in the PR description.
 */

const DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const FILE = "20261112000005_dograh_transcript_source.sql";

const sql = readFileSync(DIR + FILE, "utf8")
  .split(/\r?\n/)
  .map((l) => l.replace(/--.*$/, ""))
  .join(" ")
  .replace(/\s+/g, " ")
  .toLowerCase();
const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);

describe("dograh transcript source migration", () => {
  it("only re-creates the source check, and can run twice", () => {
    expect(stmts).toEqual([
      "alter table public.interview_sessions drop constraint if exists interview_sessions_transcript_source_check",
      "alter table public.interview_sessions add constraint interview_sessions_transcript_source_check check (transcript_source in ('client_gemini_live', 'dograh_webhook'))",
    ]);
  });

  it("allows exactly the sources the code accepts", () => {
    const list = /check \(transcript_source in \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const allowed = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual([...TRANSCRIPT_SOURCES].sort());
  });

  it("sorts after the migration that creates the source check", () => {
    // Later migrations may follow it; it only has to come after the check exists.
    const CREATES_CHECK = "20261111000003_ai_transcript_persistence.sql";
    const names = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(names).toContain(CREATES_CHECK);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf(CREATES_CHECK));
  });

  it("changes no table, grant, policy or function", () => {
    expect(sql).not.toMatch(/\b(create table|drop table|drop column|grant|revoke|create policy|create or replace function|security definer)\b/);
  });
});
