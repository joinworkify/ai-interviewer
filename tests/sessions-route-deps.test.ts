import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const createAdminClient = vi.fn(() => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const { runSessionRoute } = await import("@/lib/sessions/route-deps");

const USER = "11111111-2222-4333-8444-555555555555";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
}

beforeEach(() => {
  createClient.mockClear();
  createAdminClient.mockClear();
  getClaims.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runSessionRoute", () => {
  it("returns 503 naming the missing variables without creating a client or running the handler", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const run = vi.fn();
    const res = await runSessionRoute(run);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
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
    const res = await runSessionRoute(run);
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });

  it("hands the handler a getUserId backed by verified claims", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    let seen: string | null = null;
    const res = await runSessionRoute(async (deps) => {
      seen = await deps.getUserId();
      return Response.json({ ok: true }, { status: 201 });
    });
    expect(seen).toBe(USER);
    expect(res.status).toBe(201);
  });

  it.each([
    ["no claims", { data: { claims: null }, error: null }],
    ["an auth error", { data: { claims: { sub: USER } }, error: new Error("bad") }],
    ["a non-string sub", { data: { claims: { sub: 42 } }, error: null }],
    ["no data", { data: null, error: null }],
  ])("getUserId is null for %s", async (_name, result) => {
    configure();
    getClaims.mockResolvedValue(result);
    let seen: string | null | undefined;
    await runSessionRoute(async (deps) => {
      seen = await deps.getUserId();
      return new Response(null, { status: 204 });
    });
    expect(seen).toBeNull();
  });

  it("passes process.env, a store and a usage store", async () => {
    configure();
    let keys: string[] = [];
    await runSessionRoute(async (deps) => {
      expect(deps.env).toBe(process.env);
      keys = Object.keys(deps);
      return new Response(null, { status: 204 });
    });
    expect(keys).toEqual(expect.arrayContaining(["env", "getUserId", "store", "usage"]));
    expect(createAdminClient).toHaveBeenCalledTimes(1);
  });

  it("turns an unexpected failure into a generic 500 without leaking the error", async () => {
    configure();
    createClient.mockRejectedValueOnce(new Error("cookie store exploded sb_secret_test"));
    const res = await runSessionRoute(async () => new Response(null));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("internal_error");
    expect(text).not.toContain("sb_secret_test");
  });
});
