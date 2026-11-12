import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getClaims } })),
}));
vi.mock("@/lib/utils", () => ({ hasEnvVars: true }));

const { updateSession } = await import("@/lib/supabase/proxy");

beforeEach(() => {
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: null } });
});

describe("transcript route and the login redirect", () => {
  it("lets a signed-out PUT through so the route can answer a JSON 401", async () => {
    const res = await updateSession(
      new NextRequest("http://localhost:3000/api/sessions/abc/transcript", { method: "PUT" }),
    );
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });
});
