import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const lookup = vi.fn();
const selectChain = { select: vi.fn(() => selectChain), eq: vi.fn(() => selectChain), maybeSingle: lookup };
const createClient = vi.fn(async () => ({ auth: { getClaims }, from: vi.fn(() => selectChain) }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const inserts: { table: string; row: Record<string, unknown> }[] = [];
const createAdminClient = vi.fn(() => ({
  from(table: string) {
    const chain = {
      insert(row: Record<string, unknown>) {
        inserts.push({ table, row });
        return chain;
      },
      select: () => chain,
      single: async () => ({
        data: { id: table === "interviews" ? "iv-1" : "22222222-2222-4222-8222-222222222222" },
        error: null,
      }),
    };
    return chain;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const { POST } = await import("@/app/api/candidate/attempts/route");
const { GET } = await import("@/app/api/candidate/attempts/[id]/route");

const USER = "11111111-2222-4333-8444-555555555555";
const SESSION = "22222222-2222-4222-8222-222222222222";
const SECRET = "sb_secret_DO-NOT-LEAK-123";

function post(headers: Record<string, string> = {}, body: unknown = { roleId: "software-engineer" }) {
  return POST(
    new Request("http://localhost:3000/api/candidate/attempts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
}

beforeEach(() => {
  inserts.length = 0;
  createClient.mockClear();
  createAdminClient.mockClear();
  getClaims.mockReset();
  lookup.mockReset();
  selectChain.eq.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/candidate/attempts", () => {
  it("blocks a cross-site request before doing any work", async () => {
    configure();
    const res = await post({ origin: "http://evil.example" });
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("blocks a request with no Origin header", async () => {
    configure();
    const res = await POST(
      new Request("http://localhost:3000/api/candidate/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: "software-engineer" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 503 naming each missing variable, and creates no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("answers 401 and writes nothing when nobody is signed in", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await post();
    expect(res.status).toBe(401);
    expect(inserts).toEqual([]);
  });

  it("answers 401 when getClaims reports an error", async () => {
    configure();
    getClaims.mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    expect((await post()).status).toBe(401);
    expect(inserts).toEqual([]);
  });

  it("creates the interview and session for the user in the claims", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      success: true,
      attempt: { sessionId: SESSION, roleId: "software-engineer" },
    });
    expect(inserts.map((i) => i.table)).toEqual(["interviews", "interview_sessions"]);
    expect(inserts[0].row.user_id).toBe(USER);
    expect(inserts[1].row).toEqual({ user_id: USER, interview_id: "iv-1" });
  });

  it("ignores a user id sent in the body", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await post({}, { roleId: "software-engineer", userId: "99999999-2222-4333-8444-555555555555" });
    expect(res.status).toBe(400);
    expect(inserts).toEqual([]);
  });

  it("accepts the legacy SUPABASE_SERVICE_ROLE_KEY name when the secret key is blank", async () => {
    configure();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-key");
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    expect((await post()).status).toBe(201);
  });

  it("answers a generic 500 without leaking the secret when the admin client cannot be built", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    createAdminClient.mockImplementationOnce(() => {
      throw new Error(`bad key ${SECRET}`);
    });
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(SECRET);
  });
});

describe("GET /api/candidate/attempts/[id]", () => {
  const get = (id = SESSION) =>
    GET(new Request(`http://localhost:3000/api/candidate/attempts/${id}`), {
      params: Promise.resolve({ id }),
    });
  const row = (over: Record<string, unknown> = {}) => ({
    id: SESSION,
    interview_id: "iv-1",
    user_id: USER,
    status: "completed",
    started_at: "2026-11-13T00:00:00Z",
    ended_at: null,
    transcript: [{ role: "interviewer", text: "Q?" }, { role: "candidate", text: "SECRET-ANSWER" }],
    transcript_source: "dograh_webhook",
    ...over,
  });

  it("returns 503 naming each missing variable, and creates no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await get();
    expect(res.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, without reading", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    expect((await get()).status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reads the caller's own session and returns the status only", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    lookup.mockResolvedValue({ data: row(), error: null });
    const res = await get();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ success: true, attempt: { sessionId: SESSION, status: "submitted" } });
    expect(text).not.toMatch(/SECRET-ANSWER|transcript|feedback/i);
    expect(selectChain.eq).toHaveBeenCalledWith("user_id", USER);
  });

  it("answers 404 for another user's session", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    lookup.mockResolvedValue({ data: row({ user_id: "99999999-2222-4333-8444-555555555555" }), error: null });
    expect((await get()).status).toBe(404);
  });

  it("answers a generic 500 when the database errors", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    lookup.mockResolvedValue({ data: null, error: { code: "XX000", message: "SECRET-DB-TEXT" } });
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("SECRET-DB-TEXT");
  });
});
