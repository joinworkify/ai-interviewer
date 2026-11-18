import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";

const { exchangeCodeForSession } = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));
beforeEach(() => {
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});
describe("email/OAuth PKCE callback", () => {
  it("exchanges the confirmation code before redirecting to the role application", async () => {
    const next = "/candidate/resume?role=engineer";
    const response = await GET(
      new NextRequest(
        `https://app.example/auth/callback?code=test-only-code&next=${encodeURIComponent(next)}`,
      ),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("test-only-code");
    expect(response.headers.get("location")).toBe(`https://app.example${next}`);
  });

  it("does not enter a protected application after an invalid confirmation code", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });
    const response = await GET(
      new NextRequest("https://app.example/auth/callback?code=expired&next=%2Fcandidate%2Fresume"),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example/auth/login?error=oauth_failed",
    );
  });

  it("does not follow an external continuation after a valid code", async () => {
    const response = await GET(
      new NextRequest(
        "https://app.example/auth/callback?code=test-only-code&next=https%3A%2F%2Fevil.example",
      ),
    );
    expect(response.headers.get("location")).toBe("https://app.example/candidate/roles");
  });
});
