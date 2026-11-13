import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getClaims } })),
}));
vi.mock("@/lib/utils", () => ({ hasEnvVars: true }));

const { updateSession } = await import("@/lib/supabase/proxy");

const ORIGIN = "http://localhost:3000";

function post(path: string) {
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST" });
}

beforeEach(() => {
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: null } }); // signed out
});

describe("Supabase proxy login redirect", () => {
  it("lets signed-out POST /api/gemini-live/token through so the route returns JSON 401", async () => {
    const res = await updateSession(post("/api/gemini-live/token"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
    // Session refresh still ran (getClaims is called before the exemption check).
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it.each([
    "/api/gemini-live/token/",
    "/api/gemini-live/token/extra",
    "/api/gemini-live/tokenx",
    "/api/gemini-live",
    "/api/gemini-live/other",
    "/api/interviews/capability",
    "/protected/interview/gemini",
  ])("still redirects signed-out %s to /auth/login", async (path) => {
    const res = await updateSession(post(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toMatch(
      /^\/auth\/login\/?$/,
    );
  });

  it.each([
    "/candidate",
    "/candidate/roles",
    "/candidate/roles/software-engineer",
    "/candidate/consent",
  ])("redirects signed-out %s to /auth/login (candidate pages need a session)", async (path) => {
    const res = await updateSession(post(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toMatch(/^\/auth\/login\/?$/);
  });

  it.each([
    "/api/dograh/session",
    "/api/dograh/webhook",
    "/api/candidate/attempts",
    "/api/candidate/attempts/22222222-2222-4222-8222-222222222222",
  ])(
    "lets signed-out POST %s through so the route can answer for itself",
    async (path) => {
      const res = await updateSession(post(path));
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each([
    "/api/dograh",
    "/api/dograh/",
    "/api/dograh/other",
    "/api/dograh/session/",
    "/api/dograh/session/extra",
    "/api/dograh/webhook/extra",
    "/api/dograh/webhookx",
    "/api/candidate",
    "/api/candidate/attempts/",
    "/api/candidate/attempts/extra",
    "/api/candidate/attempts/22222222-2222-4222-8222-222222222222/more",
    "/api/candidate/attempts/22222222-2222-4222-8222-22222222222",
    "/api/candidate/other",
    "/protected/interview/dograh",
  ])("still redirects signed-out %s to /auth/login", async (path) => {
    const res = await updateSession(post(path));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toMatch(/^\/auth\/login\/?$/);
  });

  it("keeps the existing Vapi webhook exemption", async () => {
    const res = await updateSession(post("/api/vapi/generate-interview"));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("unauth route chain", () => {
  it("proxy passes through and the token route answers a structured 401", async () => {
    const proxied = await updateSession(post("/api/gemini-live/token"));
    expect(proxied.headers.get("location")).toBeNull();

    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getClaims: async () => ({ data: null, error: null }) },
      }),
    }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const { POST } = await import("@/app/api/gemini-live/token/route");
    const res = await POST(
      new Request(`${ORIGIN}/api/gemini-live/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ role: "SRE", level: "mid", techstack: "Go" }),
      }),
    );
    vi.unstubAllEnvs();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });
});
