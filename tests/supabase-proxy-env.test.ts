import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Without the Supabase env vars the proxy cannot tell who is signed in. In
 * local development it steps aside; in production it must fail closed.
 */

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getClaims } })),
}));
vi.mock("@/lib/utils", () => ({ hasEnvVars: undefined }));

const { updateSession } = await import("@/lib/supabase/proxy");

const get = (path: string) => new NextRequest(`http://localhost:3000${path}`);

afterEach(() => {
  vi.unstubAllEnvs();
  getClaims.mockReset();
});

describe("proxy without Supabase env vars", () => {
  it("answers 503 in production for every path, and never creates a client", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const path of ["/", "/candidate/roles", "/protected", "/api/sessions", "/auth/login"]) {
      const res = await updateSession(get(path));
      expect(res.status, path).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("does not leak configuration in the 503 body", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await updateSession(get("/candidate/roles"));
    const text = await res.text();
    expect(text).not.toMatch(/SUPABASE|env/i);
  });

  it.each(["development", "test"])("steps aside in %s so the setup screens load", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    const res = await updateSession(get("/candidate/roles"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });
});
