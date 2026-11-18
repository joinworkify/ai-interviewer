import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Runs scripts/check-env.mjs in a temporary directory with a fixture
 * .env.local and an otherwise empty environment, so the result depends only on
 * the fixture (never on the developer's real .env.local or shell).
 */

const SCRIPT = fileURLToPath(new URL("../scripts/check-env.mjs", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const A = "a".repeat(40);

const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  LLM_API_KEY: "llm-key-x",
  LLM_MODEL: "model-x",
};
const GEMINI = { GEMINI_API_KEY: "gem-key", GEMINI_LIVE_MODEL: "gemini-live-x" };
const VAPI = {
  NEXT_PUBLIC_VAPI_PUBLIC_KEY: "pub",
  NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID: "asst",
  VAPI_TOOL_SIGNING_SECRET: A,
};

function run(vars: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "check-env-"));
  dirs.push(dir);
  writeFileSync(join(dir, ".env.local"), Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n"));
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("scripts/check-env.mjs", () => {
  it("passes with Gemini Live only (no Vapi variables)", () => {
    const r = run({ ...BASE, ...GEMINI });
    expect(r.code).toBe(0);
    expect(r.out).toContain("voice providers: Gemini Live");
  });

  it("passes with Vapi only", () => {
    expect(run({ ...BASE, ...VAPI }).code).toBe(0);
  });

  it("lists every configured provider", () => {
    const r = run({ ...BASE, ...GEMINI, ...VAPI });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Gemini Live, Vapi");
  });

  it("fails when no voice provider is configured", () => {
    const r = run(BASE);
    expect(r.code).toBe(1);
    expect(r.out).toContain("No voice provider is configured");
  });

  it("fails when a provider is only partly configured, naming the missing variables", () => {
    const { GEMINI_LIVE_MODEL: _omit, ...partial } = GEMINI;
    void _omit;
    const r = run({ ...BASE, ...VAPI, ...partial });
    expect(r.code).toBe(1);
    expect(r.out).toContain("Gemini Live is partly configured");
    expect(r.out).toContain("GEMINI_LIVE_MODEL");
  });

  it("fails when always-required variables are missing or still placeholders", () => {
    const { LLM_API_KEY: _omit, ...rest } = BASE;
    void _omit;
    const r = run({ ...rest, SUPABASE_SECRET_KEY: "your-supabase-secret-key", ...GEMINI });
    expect(r.code).toBe(1);
    expect(r.out).toContain("LLM_API_KEY");
    expect(r.out).toContain("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  });

  it("accepts the legacy service-role name for the Supabase secret", () => {
    const { SUPABASE_SECRET_KEY: _omit, ...rest } = BASE;
    void _omit;
    expect(run({ ...rest, SUPABASE_SERVICE_ROLE_KEY: "legacy", ...GEMINI }).code).toBe(0);
  });

  it("rejects short secrets", () => {
    const vapiShort = run({ ...BASE, ...VAPI, VAPI_TOOL_SIGNING_SECRET: "short" });
    expect(vapiShort.code).toBe(1);
    expect(vapiShort.out).toContain("VAPI_TOOL_SIGNING_SECRET must be at least 32 characters");
  });

  it("requires an https LLM_BASE_URL", () => {
    const r = run({ ...BASE, ...GEMINI, LLM_BASE_URL: "http://llm.example/v1" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("LLM_BASE_URL must be HTTPS");
  });

  it("never prints a variable value", () => {
    const secret = "super-secret-value-0123456789-abcdefghijkl";
    const r = run({ ...BASE, ...GEMINI, ...VAPI, LLM_API_KEY: secret, GEMINI_API_KEY: secret, VAPI_TOOL_SIGNING_SECRET: secret });
    expect(r.out).not.toContain(secret);
  });
});
