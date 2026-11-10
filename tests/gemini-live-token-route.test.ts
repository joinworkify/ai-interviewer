import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims } }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

const createGeminiAuthToken = vi.fn();
vi.mock("@/lib/gemini-live/google-token", () => ({ createGeminiAuthToken }));

const { POST } = await import("@/app/api/gemini-live/token/route");

const USER = "11111111-2222-4333-8444-555555555555";
const URL_ = "http://localhost:3000/api/gemini-live/token";

function req(body: unknown = { role: "Designer", level: "mid", techstack: "Figma" }) {
  return new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function configure() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("GEMINI_API_KEY", "server-key");
  vi.stubEnv("GEMINI_LIVE_MODEL", "gemini-3.8-live");
}

beforeEach(() => {
  createClient.mockClear();
  getClaims.mockReset();
  createGeminiAuthToken.mockReset();
  createGeminiAuthToken.mockResolvedValue({ name: "auth_tokens/route" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/gemini-live/token", () => {
  it("returns 503 without calling createClient when Supabase env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns 401 when getClaims has no user", async () => {
    configure();
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await POST(req())).status).toBe(401);
    expect(createGeminiAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 when getClaims errors", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: new Error("bad") });
    expect((await POST(req())).status).toBe(401);
  });

  it("returns 503 when Gemini env is missing for a signed-in user", async () => {
    configure();
    vi.stubEnv("GEMINI_API_KEY", "");
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual(["GEMINI_API_KEY"]);
  });

  it("issues a token using the server key for the session user", async () => {
    configure();
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).token).toBe("auth_tokens/route");
    expect(createGeminiAuthToken).toHaveBeenCalledWith(
      "server-key",
      expect.objectContaining({ uses: 1 }),
    );
  });

  it("returns a generic 500 if something unexpected throws", async () => {
    configure();
    getClaims.mockRejectedValue(new Error("secret internals"));
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret internals");
  });
});
