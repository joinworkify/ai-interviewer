// Verifies the env vars the app needs are set. Prints variable NAMES only,
// never values. Reads .env.local, falling back to the process environment.
import { existsSync, readFileSync } from "node:fs";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_VAPI_PUBLIC_KEY",
  "NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID",
  "VAPI_TOOL_SIGNING_SECRET",
  "SUPABASE_SECRET_KEY",
  "LLM_API_KEY",
  "LLM_MODEL",
];
const OPTIONAL = ["LLM_BASE_URL", "LLM_TIMEOUT_MS"];
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

const problems = [];
const missing = REQUIRED.filter((n) => !isSet(n));
if (missing.length) problems.push(`Missing or placeholder: ${missing.join(", ")}`);

if (isSet("VAPI_TOOL_SIGNING_SECRET") && get("VAPI_TOOL_SIGNING_SECRET").length < 32) {
  problems.push("VAPI_TOOL_SIGNING_SECRET must be at least 32 characters (npm run setup:secret)");
}
if (isSet("LLM_BASE_URL") && !get("LLM_BASE_URL").startsWith("https://")) {
  problems.push("LLM_BASE_URL must be HTTPS");
}

// Dograh is optional, but half a setup is a mistake: when any of its variables
// is set, all the required ones must be, and the secrets must be usable.
const DOGRAH_REQUIRED = [
  "DOGRAH_API_URL",
  "DOGRAH_WEBHOOK_SECRET",
  "DOGRAH_SESSION_SIGNING_SECRET",
  "NEXT_PUBLIC_DOGRAH_WIDGET_SRC",
];
const dograhInUse = [...DOGRAH_REQUIRED, "DOGRAH_STORAGE_URL"].some(isSet);
if (dograhInUse) {
  const dograhMissing = DOGRAH_REQUIRED.filter((n) => !isSet(n));
  if (dograhMissing.length) {
    problems.push(`Dograh is partly configured. Missing or placeholder: ${dograhMissing.join(", ")}`);
  }
  for (const name of ["DOGRAH_WEBHOOK_SECRET", "DOGRAH_SESSION_SIGNING_SECRET"]) {
    if (isSet(name) && get(name).length < 32) {
      problems.push(`${name} must be at least 32 characters (npm run setup:secret)`);
    }
  }
  if (
    isSet("DOGRAH_WEBHOOK_SECRET") &&
    get("DOGRAH_WEBHOOK_SECRET") === get("DOGRAH_SESSION_SIGNING_SECRET")
  ) {
    problems.push("DOGRAH_SESSION_SIGNING_SECRET must differ from DOGRAH_WEBHOOK_SECRET");
  }
}

const unsetOptional = OPTIONAL.filter((n) => !isSet(n));
if (unsetOptional.length) console.log(`Optional, not set: ${unsetOptional.join(", ")}`);

if (problems.length) {
  for (const p of problems) console.error(`x ${p}`);
  process.exit(1);
}
console.log(`ok: all ${REQUIRED.length} required env vars are set`);
