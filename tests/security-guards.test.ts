import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lightweight repo guards (static, no network). They fail when someone:
 *  - lets browser code reach the service-role client or key,
 *  - adds a mutating /api/sessions or /api/account route with no origin check,
 *  - logs raw errors or uses console.log/info/debug in server code.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["app", "components", "lib", "hooks"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const source = new Map(files.map((f) => [rel(f), readFileSync(f, "utf8")]));

const ADMIN = "lib/supabase/admin.ts";
const SECRET_ENV = /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/;
const IMPORT_RE =
  /(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = rel(resolve(ROOT, dirname(from), spec));
  else return null; // package import
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const text = source.get(file) ?? "";
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[1] ?? m[2] ?? m[3]);
    if (target) out.push(target);
  }
  return out;
}

const isClientModule = (file: string) =>
  /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(source.get(file) ?? "");
const importsServerOnly = (file: string) =>
  /import\s+["']server-only["']/.test(source.get(file) ?? "");

describe("the admin (service-role) client stays server-only", () => {
  it("admin.ts imports server-only", () => {
    expect(importsServerOnly(ADMIN)).toBe(true);
  });

  it("every importer of the admin client is server-only code or a route handler", () => {
    const importers = [...source.keys()].filter((f) => importsOf(f).includes(ADMIN));
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      const ok = importsServerOnly(f) || /^app\/.*\/route\.ts$/.test(f);
      expect(ok, `${f} imports the admin client but is not server-only`).toBe(true);
    }
  });

  it("no 'use client' module can reach the admin client, the service-role key or a server-only module", () => {
    const entries = [...source.keys()].filter(isClientModule);
    expect(entries.length).toBeGreaterThan(0); // the walk has something to walk
    const reached = new Map<string, string>(); // file -> the client entry it was reached from
    const queue = entries.map((e) => [e, e] as const);
    while (queue.length > 0) {
      const [file, entry] = queue.pop()!;
      if (reached.has(file)) continue;
      reached.set(file, entry);
      for (const next of importsOf(file)) queue.push([next, entry]);
    }
    expect(reached.size).toBeGreaterThan(entries.length); // the walk follows imports
    for (const [file, entry] of reached) {
      expect(file, `reachable from client module ${entry}`).not.toBe(ADMIN);
      expect(SECRET_ENV.test(source.get(file)!), `${file} reads the service-role key (reachable from ${entry})`).toBe(false);
      expect(importsServerOnly(file), `${file} is server-only but reachable from ${entry}`).toBe(false);
    }
  });

  it("only reviewed files read the service-role key", () => {
    const allowed = new Set([
      ADMIN,
      "lib/interviews/store.ts", // builds its own service-role client for the Vapi webhook path
      "lib/sessions/route-deps.ts", // 503 when the key is missing
      "lib/data-deletion/route-deps.ts", // 503 when the key is missing
      "lib/transcripts/route-deps.ts", // 503 when the key is missing; transcript writes use the admin client
      "lib/dograh/route-deps.ts", // 503 when the key is missing; the webhook writes the transcript with the admin client
      "app/protected/interview/page.tsx", // server component: shows whether the key is set (never its value)
    ]);
    const readers = [...source.keys()].filter((f) => SECRET_ENV.test(source.get(f)!));
    for (const f of readers) expect(allowed.has(f), `${f} reads the service-role key: review it, then add it here`).toBe(true);
  });
});

describe("mutating routes check the request origin", () => {
  const MUTATING = /export\s+(?:async\s+function|const|function)\s+(POST|PUT|PATCH|DELETE)\b/;
  const routes = [...source.keys()].filter(
    (f) => /^app\/api\/(sessions|account)\/.*route\.ts$/.test(f) || f === "app/api/sessions/route.ts",
  );

  it("finds the session and account routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  /** Each mutating handler's own text: from its `export` to the next `export`. */
  function handlersOf(text: string): { method: string; body: string }[] {
    const starts = [...text.matchAll(/export\s+(?:async\s+function|const|function)\s+(\w+)/g)];
    return starts.map((m, i) => ({
      method: m[1],
      body: text.slice(m.index, starts[i + 1]?.index ?? text.length),
    }));
  }

  it.each(routes.filter((f) => MUTATING.test(source.get(f)!)))(
    "%s calls guardSameOrigin before doing any work in each mutating handler",
    (file) => {
      const mutating = handlersOf(source.get(file)!).filter((h) => /^(POST|PUT|PATCH|DELETE)$/.test(h.method));
      expect(mutating.length).toBeGreaterThan(0);
      for (const { method, body } of mutating) {
        const guard = body.indexOf("guardSameOrigin(request");
        expect(guard, `${file} ${method} must call guardSameOrigin(request, ...)`).toBeGreaterThan(-1);
        const work = body.search(/run(?:Session|Deletion|Transcript)Route\(/);
        expect(guard, `${file} ${method} must guard before running`).toBeLessThan(work);
      }
    },
  );
});

/** Arguments of console.error/warn calls that are a bare error identifier. */
function findRawErrorLogs(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/console\.(?:error|warn)\(((?:[^;]|\n)*?)\);/g)) {
    // Split on top-level commas only, so describeError(err) is not flagged.
    const args: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of m[1]) {
      if ("([{".includes(ch)) depth++;
      if (")]}".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else current += ch;
    }
    args.push(current.trim());
    if (args.some((a) => /^(err|error|e|reason|cause|ex)$/.test(a))) found.push(m[1].trim().slice(0, 60));
  }
  return found;
}

describe("server logging rules", () => {
  const serverFiles = [...source.keys()].filter((f) => f.startsWith("app/api/") || f.startsWith("lib/"));

  it("the raw-error detector flags raw errors and accepts safe forms", () => {
    expect(findRawErrorLogs('console.error("x", err);')).toHaveLength(1);
    expect(findRawErrorLogs('console.error("x", r.reason);')).toHaveLength(0); // member access is a separate review item
    expect(findRawErrorLogs('console.warn(\n  "x",\n  error,\n);')).toHaveLength(1);
    expect(findRawErrorLogs('console.error("x", describeError(err));')).toHaveLength(0);
    expect(findRawErrorLogs("console.error(`[a] ${err.kind}`);")).toHaveLength(0);
    expect(findRawErrorLogs('console.error("static only");')).toHaveLength(0);
  });

  it("uses no console.log, console.info or console.debug", () => {
    const offenders = [...source.keys()].filter((f) => /console\.(log|info|debug)\(/.test(source.get(f)!));
    expect(offenders).toEqual([]);
  });

  it("never passes a raw error object to console.error or console.warn", () => {
    // `console.error("x", err)` can print stack, cause and upstream bodies.
    // Use describeError(err) from lib/log/safe-error.ts.
    const offenders = serverFiles.flatMap((f) => findRawErrorLogs(source.get(f)!).map((a) => `${f}: ${a}`));
    expect(offenders).toEqual([]);
  });
});
