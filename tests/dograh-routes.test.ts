import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const lookup = vi.fn();
const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: lookup };
const createAdminClient = vi.fn(() => ({ rpc, from: vi.fn(() => chain) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const getClaims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { POST: webhookPost } = await import("@/app/api/dograh/webhook/route");
const { POST: sessionPost } = await import("@/app/api/dograh/session/route");

import { API_ORIGIN, ENV, SESSION, TRANSCRIPT_TEXT, TRANSCRIPT_URL, USER, WEBHOOK_SECRET, makeToken } from "./helpers/dograh";

function stubDograhEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_DO-NOT-LEAK-123");
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

function webhook(payload: unknown, headers: Record<string, string> = {}) {
  return webhookPost(
    new Request("http://localhost:3000/api/dograh/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${WEBHOOK_SECRET}`, ...headers },
      body: JSON.stringify(payload),
    }),
  );
}

const hook = () => ({
  workflow_run_id: 7,
  duration_seconds: 30,
  call_disposition: "completed",
  session_token: makeToken(),
  transcript_url: TRANSCRIPT_URL,
});

beforeEach(() => {
  rpc.mockReset();
  lookup.mockReset();
  getClaims.mockReset();
  createAdminClient.mockClear();
  createClient.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(String(url).startsWith(API_ORIGIN)).toBe(true);
      return new Response(TRANSCRIPT_TEXT);
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/dograh/webhook", () => {
  it("rejects a request with no Bearer secret before touching the database", async () => {
    stubDograhEnv();
    const res = await webhookPost(
      new Request("http://localhost:3000/api/dograh/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hook()),
      }),
    );
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores the transcript through the service-role client for the token's user", async () => {
    stubDograhEnv();
    rpc.mockResolvedValue({ data: [{ id: SESSION, status: "completed" }], error: null });
    const res = await webhook(hook());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      session: { id: SESSION, status: "completed" },
      transcript: { source: "dograh_webhook", entries: 3 },
    });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "store_session_transcript",
      expect.objectContaining({
        p_session_id: SESSION,
        p_user_id: USER,
        p_source: "dograh_webhook",
        p_duration_seconds: 30,
      }),
    );
  });

  it("answers a generic 503 without names when Supabase is not configured", async () => {
    stubDograhEnv();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await webhook(hook(), { authorization: "Bearer anything" });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("SUPABASE");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("answers a generic 500 and leaks no secret when the admin client cannot be built", async () => {
    stubDograhEnv();
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("cannot build with sb_secret_DO-NOT-LEAK-123");
    });
    const res = await webhook(hook());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("internal_error");
    expect(text).not.toContain("DO-NOT-LEAK");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("DO-NOT-LEAK");
  });

  it("answers duplicate 200 on a repeat delivery", async () => {
    stubDograhEnv();
    rpc.mockResolvedValue({ data: [], error: null });
    lookup.mockResolvedValue({ data: { id: SESSION }, error: null });
    const res = await webhook(hook());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, duplicate: true });
  });
});

describe("POST /api/dograh/session", () => {
  const details = { sessionId: SESSION, role: "Backend Engineer", level: "senior", techstack: "Go" };

  function session(headers: Record<string, string> = {}, payload: unknown = details) {
    return sessionPost(
      new Request("http://localhost:3000/api/dograh/session", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
        body: JSON.stringify(payload),
      }),
    );
  }

  it("blocks a cross-site request before any auth or database work", async () => {
    stubDograhEnv();
    const res = await session({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden_origin");
    expect(createClient).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("answers a JSON 401 when signed out", async () => {
    stubDograhEnv();
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await session();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
  });

  it("answers 503 naming Supabase variables when they are missing", async () => {
    stubDograhEnv();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await session();
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(createClient).not.toHaveBeenCalled();
  });
});
