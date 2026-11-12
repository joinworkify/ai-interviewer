import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const signOut = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims, signOut } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const createAdminClient = vi.fn(() => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const { runDeletionRoute } = await import("@/lib/data-deletion/route-deps");

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
}

beforeEach(() => {
  createClient.mockClear();
  createAdminClient.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runDeletionRoute", () => {
  it("returns 503 naming each missing variable, without creating a client or running the handler", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const run = vi.fn();
    const res = await runDeletionRoute(run);
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("falls back to the legacy SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is blank", async () => {
    configure();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-key");
    const run = vi.fn(async () => Response.json({ ok: true }));
    const res = await runDeletionRoute(run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it("answers a generic 500 when the handler throws", async () => {
    configure();
    const res = await runDeletionRoute(async () => {
      throw new Error("sb_secret_test leaked");
    });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("leaked");
  });
});
