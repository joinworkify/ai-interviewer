import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getClaims = vi.fn();
let queryError: unknown = null;
let consentsData: unknown[] = [];
let sessionsData: unknown[] = [];
let interviewsData: unknown[] = [];
let rolesData: unknown[] = [];

const createClient = vi.fn(async () => ({
  auth: { getClaims },
  from(table: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      in: () => chain,
      then(resolve: (v: { data: unknown; error: unknown }) => void) {
        if (queryError) {
          resolve({ data: null, error: queryError });
          return;
        }
        if (table === "candidate_consents") {
          resolve({ data: consentsData, error: null });
        } else if (table === "interview_sessions") {
          resolve({ data: sessionsData, error: null });
        } else if (table === "interviews") {
          resolve({ data: interviewsData, error: null });
        } else if (table === "roles") {
          resolve({ data: rolesData, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

const { GET } = await import("@/app/api/candidate/applications/route");

const USER = "11111111-2222-4333-8444-555555555555";
const SESSION_1 = "22222222-2222-4222-8222-222222222222";
const SESSION_2 = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  queryError = null;
  consentsData = [];
  sessionsData = [];
  interviewsData = [];
  rolesData = [];
  getClaims.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/candidate/applications", () => {
  it("answers 401 when not signed in", async () => {
    getClaims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await GET(new Request("http://localhost:3000/api/candidate/applications"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, error: "unauthorized" });
  });

  it("returns empty applications list when candidate has no consents", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    consentsData = [];
    const res = await GET(new Request("http://localhost:3000/api/candidate/applications"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, applications: [] });
  });

  it("returns empty applications list when candidate has consents but no valid interviews", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    consentsData = [
      {
        id: "c-1",
        user_id: USER,
        session_id: SESSION_1,
        role_id: "software-engineer",
        accepted_at: "2026-11-18T10:00:00Z",
      },
    ];
    sessionsData = [];
    const res = await GET(new Request("http://localhost:3000/api/candidate/applications"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, applications: [] });
  });

  it("returns applications mapped with role titles from public.roles", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    consentsData = [
      {
        id: "c-1",
        user_id: USER,
        session_id: SESSION_1,
        role_id: "software-engineer",
        accepted_at: "2026-11-18T10:00:00Z",
      },
      {
        id: "c-2",
        user_id: USER,
        session_id: SESSION_2,
        role_id: "deactivated-role",
        accepted_at: "2026-11-17T10:00:00Z",
      },
    ];
    sessionsData = [
      {
        id: SESSION_1,
        user_id: USER,
        interview_id: "iv-1",
        status: "completed",
        transcript: [{ role: "candidate", text: "Answer" }],
      },
      {
        id: SESSION_2,
        user_id: USER,
        interview_id: "iv-2",
        status: "in_progress",
        transcript: null,
      },
    ];
    interviewsData = [
      { id: "iv-1", user_id: USER },
      { id: "iv-2", user_id: USER },
    ];
    rolesData = [{ id: "software-engineer", title: "Software Engineer" }];

    const res = await GET(new Request("http://localhost:3000/api/candidate/applications"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      applications: [
        {
          id: "c-1",
          roleId: "software-engineer",
          roleTitle: "Software Engineer",
          appliedAt: "2026-11-18T10:00:00Z",
          status: "submitted",
        },
        {
          id: "c-2",
          roleId: "deactivated-role",
          roleTitle: "Unknown role",
          appliedAt: "2026-11-17T10:00:00Z",
          status: "processing",
        },
      ],
    });
  });

  it("returns 500 when database throws an error", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: USER } }, error: null });
    queryError = new Error("database broke");
    const res = await GET(new Request("http://localhost:3000/api/candidate/applications"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false, error: "storage_failed" });
  });
});
