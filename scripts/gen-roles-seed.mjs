// Regenerates the candidate roles block in supabase/seed.sql from
// lib/candidate/roles.json, so the database seed and the screens show the same
// roles. Only the text between the BEGIN/END candidate roles markers changes;
// the rest of seed.sql (dev user, interviews, ...) is left as it is.
// Usage: node scripts/gen-roles-seed.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SEED = new URL("../supabase/seed.sql", import.meta.url);
const BEGIN = "-- BEGIN candidate roles";
const END = "-- END candidate roles";

const roles = JSON.parse(readFileSync(new URL("../lib/candidate/roles.json", import.meta.url), "utf8"));
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arr = (a) => (a.length ? `array[${a.map(q).join(", ")}]` : "'{}'::text[]");
const js = (v) => `${q(JSON.stringify(v))}::jsonb`;

const rows = roles
  .map(
    (r, i) =>
      `  (${q(r.id)}, ${q(r.title)}, ${q(r.payRate)}, ${q(r.jobType)}, ${i + 1},\n` +
      `   ${arr(r.skills)}, ${q(r.about ?? "")},\n` +
      `   ${js(r.responsibilities)},\n` +
      `   ${js(r.requirements)})`,
  )
  .join(",\n");

const block = `insert into public.roles
  (id, title, pay_rate, job_type, sort_order, skills, about, responsibilities, requirements)
values
${rows}
on conflict (id) do update set
  title            = excluded.title,
  pay_rate         = excluded.pay_rate,
  job_type         = excluded.job_type,
  sort_order       = excluded.sort_order,
  skills           = excluded.skills,
  about            = excluded.about,
  responsibilities = excluded.responsibilities,
  requirements     = excluded.requirements,
  updated_at       = now();
`;

const seed = readFileSync(SEED, "utf8");
const start = seed.indexOf(BEGIN);
const end = seed.indexOf(END);
if (start < 0 || end < start) throw new Error(`seed.sql needs "${BEGIN}" and "${END}" marker lines`);
const afterBegin = seed.indexOf("\n", start) + 1;
writeFileSync(SEED, seed.slice(0, afterBegin) + block + seed.slice(end));
console.log(`seed.sql: ${roles.length} roles`);
