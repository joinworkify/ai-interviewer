import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Supabase applies migrations in the order of their version prefix and keys
 * them by it: two files with the same prefix make `supabase db push` fail, and
 * a file that sorts before one already applied is refused or skipped. Several
 * branches add migrations in parallel, so this catches a clash before it
 * reaches a database.
 */

const DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const names = readdirSync(DIR)
  .filter((f) => !f.startsWith("."))
  .sort();
const NAME_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

describe("supabase/migrations file names", () => {
  it("are all <14-digit timestamp>_<snake_case>.sql", () => {
    const bad = names.filter((n) => !NAME_RE.test(n));
    expect(bad).toEqual([]);
  });

  it("have a unique version prefix", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const n of names) {
      const version = NAME_RE.exec(n)?.[1];
      if (!version) continue;
      const other = seen.get(version);
      if (other) clashes.push(`${other} and ${n} share version ${version}`);
      else seen.set(version, n);
    }
    expect(clashes).toEqual([]);
  });

  it("have valid calendar timestamps", () => {
    const invalid = names.filter((n) => {
      const v = NAME_RE.exec(n)?.[1];
      if (!v) return false;
      const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(8, 10)}:${v.slice(10, 12)}:${v.slice(12, 14)}Z`;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 19) + "Z" !== iso;
    });
    expect(invalid).toEqual([]);
  });
});
