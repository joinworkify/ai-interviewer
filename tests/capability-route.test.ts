import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyCapability } from "@/lib/interviews/capability";

const getClaims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { POST } = await import("@/app/api/interviews/capability/route");

const SECRET = "test-secret-that-is-definitely-longer-than-32-chars";
const USER = "11111111-2222-4333-8444-555555555555";

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("VAPI_TOOL_SIGNING_SECRET", SECRET);
}

beforeEach(() => {
  createClient.mockClear();
  getClaims.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/interviews/capability", () => {
  it.each([
    [["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], {}],
    [["NEXT_PUBLIC_SUPABASE_URL"], { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }],
    [["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], { NEXT_PUBLIC_SUPABASE_URL: "https://x.test" }],
  ])(
    "returns 503 listing %j without calling createClient",
    async (missing, present: Record<string, string>) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "  ");
      vi.stubEnv("VAPI_TOOL_SIGNING_SECRET", SECRET);
      for (const [k, v] of Object.entries(present)) vi.stubEnv(k, v);

      const res = await POST();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.error).toBe("server_misconfigured");
      expect(body.missing).toEqual(missing);
      expect(body.message).toMatch(/VAPI_SETUP\.md/);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("returns 401 when configured but signed out", async () => {
    configure();
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when getClaims reports an error", async () => {
    configure();
    getClaims.mockResolvedValue({
      data: { claims: { sub: USER } },
      error: new Error("bad jwt"),
    });
    expect((await POST()).status).toBe(401);
  });

  it("returns 503 when the signing secret is missing, after auth", async () => {
    configure();
    vi.stubEnv("VAPI_TOOL_SIGNING_SECRET", "");
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await POST();
    expect(res.status).toBe(503);
    expect((await res.json()).message).toMatch(/VAPI_TOOL_SIGNING_SECRET/);
  });

  it("issues a token bound to the session user", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    const verified = verifyCapability(body.token, SECRET);
    expect(verified.ok && verified.payload.sub).toBe(USER);
  });
});
