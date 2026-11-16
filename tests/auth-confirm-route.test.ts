import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

/** next/navigation's redirect() throws; capture where it was asked to go. */
class Redirected extends Error {
  constructor(public to: string) {
    super("redirect");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { GET } = await import("@/app/auth/confirm/route");

async function target(query: string): Promise<string> {
  try {
    await GET(new NextRequest(`http://localhost:3000/auth/confirm?${query}`));
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error("GET did not redirect");
}

beforeEach(() => {
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValue({ error: null });
});

describe("GET /auth/confirm", () => {
  it("follows an on-site next after a good token", async () => {
    expect(await target("token_hash=t&type=email&next=/candidate/roles")).toBe("/candidate/roles");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "t" });
  });

  it("goes to / when next is missing", async () => {
    expect(await target("token_hash=t&type=email")).toBe("/");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/..//evil.example",
  ])("falls back to / for next=%s", async (next) => {
    const to = await target(`token_hash=t&type=email&next=${encodeURIComponent(next)}`);
    expect(to).toBe("/");
  });

  it("keeps a percent-encoded backslash as an on-site path (it cannot leave the site)", async () => {
    const to = await target("token_hash=t&type=email&next=/%5Cevil.example");
    expect(to.startsWith("/")).toBe(true);
    expect(to.startsWith("//")).toBe(false);
    expect(to.includes("\\")).toBe(false);
  });

  it("sends a bad token to the error page, with the message encoded", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired & is <invalid>" } });
    const to = await target("token_hash=t&type=email&next=/candidate/roles");
    expect(to).toBe("/auth/error?error=Token%20has%20expired%20%26%20is%20%3Cinvalid%3E");
  });

  it("sends a request with no token to the error page without calling Supabase", async () => {
    const to = await target("next=/candidate/roles");
    expect(to).toBe("/auth/error?error=No%20token%20hash%20or%20type");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
