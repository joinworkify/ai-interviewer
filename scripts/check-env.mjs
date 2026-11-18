// Verifies the env vars the app needs are set. Prints variable NAMES only,
// never values. Reads .env.local, falling back to the process environment.
//
// Two kinds of variable:
//  - always required: Supabase and the evaluation LLM;
//  - voice providers (Gemini Live, Vapi): at least one must be fully
//    configured, and a provider with only some of its variables set is a
//    mistake. A deployment that uses a single provider does not need the
//    others' variables.
import { existsSync, readFileSync } from "node:fs";

// A name list means "any one of these": the legacy service-role name is also
// accepted for the Supabase secret (see lib/supabase/admin.ts).
const ALWAYS_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  "LLM_API_KEY",
  "LLM_MODEL",
];
const OPTIONAL = ["LLM_BASE_URL", "LLM_TIMEOUT_MS"];

const PROVIDERS = [
  {
    name: "Gemini Live",
    required: ["GEMINI_API_KEY", "GEMINI_LIVE_MODEL"],
    optional: [],
    minLength: [],
  },
  {
    name: "Vapi (question generator)",
    required: [
      "NEXT_PUBLIC_VAPI_PUBLIC_KEY",
      "NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID",
      "VAPI_TOOL_SIGNING_SECRET",
    ],
    optional: [],
    minLength: ["VAPI_TOOL_SIGNING_SECRET"],
  },
];
const MIN_SECRET_LENGTH = 32;

// Values copied verbatim from .env.example count as "not set".
const PLACEHOLDER = /^(your-|replace-with-|\[INSERT)/;

function parseEnvFile(path) {
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const file = ".env.local";
const fromFile = existsSync(file) ? parseEnvFile(file) : {};
if (!existsSync(file)) {
  console.warn(`! ${file} not found (run: npm run setup:env); using process env only`);
}

const get = (name) => (process.env[name] ?? fromFile[name] ?? "").trim();
const isSet = (name) => get(name) !== "" && !PLACEHOLDER.test(get(name));
const isMet = (req) => (Array.isArray(req) ? req.some(isSet) : isSet(req));
const label = (req) => (Array.isArray(req) ? req.join(" or ") : req);

const problems = [];

const missing = ALWAYS_REQUIRED.filter((r) => !isMet(r));
if (missing.length) problems.push(`Missing or placeholder: ${missing.map(label).join(", ")}`);

if (isSet("LLM_BASE_URL") && !get("LLM_BASE_URL").startsWith("https://")) {
  problems.push("LLM_BASE_URL must be HTTPS");
}

const configured = [];
for (const p of PROVIDERS) {
  const touched = [...p.required, ...p.optional].some(isSet);
  if (!touched) continue;
  const absent = p.required.filter((n) => !isSet(n));
  if (absent.length) {
    problems.push(`${p.name} is partly configured. Missing or placeholder: ${absent.join(", ")}`);
    continue;
  }
  let ok = true;
  for (const name of p.minLength) {
    if (get(name).length < MIN_SECRET_LENGTH) {
      problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (npm run setup:secret)`);
      ok = false;
    }
  }
  if (ok) configured.push(p.name);
}

if (configured.length === 0 && !problems.some((p) => /is partly configured|at least/.test(p))) {
  problems.push(
    `No voice provider is configured. Set up at least one of: ${PROVIDERS.map((p) => p.name).join(", ")}`,
  );
}

const unsetOptional = OPTIONAL.filter((n) => !isSet(n));
if (unsetOptional.length) console.log(`Optional, not set: ${unsetOptional.join(", ")}`);

if (problems.length) {
  for (const p of problems) console.error(`x ${p}`);
  process.exit(1);
}
console.log(
  `ok: ${ALWAYS_REQUIRED.length} required env vars are set; voice providers: ${configured.join(", ")}`,
);
