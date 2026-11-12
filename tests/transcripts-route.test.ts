import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const rpc = vi.fn();
const lookup = vi.fn();
const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  maybeSingle: lookup,
};
const from = vi.fn(() => chain);
const createAdminClient = vi.fn(() => ({ rpc, from }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

const { PUT } = await import("@/app/api/sessions/[id]/transcript/route");

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const SID = "22222222-2222-4222-8222-222222222222";
const SECRET = "sb_secret_DO-NOT-LEAK-123";
const CANDIDATE_TEXT = "SECRET-CANDIDATE-ANSWER";

const body = (over: Record<string, unknown> = {}) => ({
  source: "client_gemini_live",
  payload: {
    entries: [
      { speaker: "interviewer", text: "Tell me about indexes." },
      { speaker: "candidate", text: CANDIDATE_TEXT },
    ],
    durationSeconds: 30,
    endedReason: "user_ended",
  },
  ...over,
});

function put(payload: unknown = body(), headers: Record<string, string> = {}) {
  return PUT(
    new Request(`http://localhost:3000/api/sessions/${SID}/transcript`, {
      method: "PUT",
      // Browsers always send Origin on a PUT; the route rejects a missing or foreign one.
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...headers,
      },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: SID }) },
  );
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET);
}

function signedInAs(sub: string) {
  getClaims.mockResolvedValue({ data: { claims: { sub } }, error: null });
}

beforeEach(() => {
  createClient.mockClear();
  createAdminClient.mockClear();
  getClaims.mockReset();
  rpc.mockReset();
  lookup.mockReset();
  from.mockClear();
  chain.eq.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PUT /api/sessions/[id]/transcript", () => {
  it("returns 503 naming each missing variable, and creates no client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await put();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
    ]);
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("accepts the legacy SUPABASE_SERVICE_ROLE_KEY name for the secret", async () => {
    configure();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-key");
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    expect((await put()).status).toBe(401);
  });

  it("returns 401 and never writes when nobody is signed in", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await put();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when getClaims reports an error", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: new Error("bad jwt") });
    expect((await put()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores the transcript with the user id from the claims", async () => {
    configure();
    signedInAs(USER);
    rpc.mockResolvedValue({ data: [{ id: SID, status: "completed" }], error: null });
    const res = await put();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      session: { id: SID, status: "completed" },
      transcript: { source: "client_gemini_live", entries: 2 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "store_session_transcript",
      expect.objectContaining({
        p_session_id: SID,
        p_user_id: USER,
        p_source: "client_gemini_live",
        p_duration_seconds: 30,
        p_ended_reason: "user_ended",
        p_transcript: [
          { role: "interviewer", text: "Tell me about indexes." },
          { role: "candidate", text: CANDIDATE_TEXT },
        ],
      }),
    );
  });

  it("rejects a user id supplied in the body and never calls the database", async () => {
    configure();
    signedInAs(USER);
    const res = await put(body({ userId: OTHER, user_id: OTHER }));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 409 when the session exists for this user but already has a transcript", async () => {
    configure();
    signedInAs(USER);
    rpc.mockResolvedValue({ data: [], error: null });
    lookup.mockResolvedValue({ data: { id: SID }, error: null });
    const res = await put();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("transcript_already_stored");
    // The follow-up lookup is scoped to the signed-in user too.
    expect(chain.eq).toHaveBeenCalledWith("user_id", USER);
  });

  it("answers 404 when no such session exists for this user", async () => {
    configure();
    signedInAs(USER);
    rpc.mockResolvedValue({ data: [], error: null });
    lookup.mockResolvedValue({ data: null, error: null });
    const res = await put();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("answers a generic 500 when the database errors, without leaking text", async () => {
    configure();
    signedInAs(USER);
    rpc.mockResolvedValue({ data: null, error: { message: `boom ${SECRET}` } });
    const res = await put();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("storage_failed");
    expect(text).not.toContain(CANDIDATE_TEXT);
    expect(text).not.toContain("boom");
  });

  it("answers internal_error when the admin client cannot be built, leaking no secret or text", async () => {
    configure();
    signedInAs(USER);
    createAdminClient.mockImplementationOnce(() => {
      throw new Error(`cannot build client with ${SECRET}`);
    });
    const res = await put();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error).toBe("internal_error");
    expect(text).not.toContain(SECRET);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(CANDIDATE_TEXT);
  });
});
