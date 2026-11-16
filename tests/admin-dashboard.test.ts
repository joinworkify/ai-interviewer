import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { isAdminClaims, isReviewStatus } from "@/lib/admin/access";
import { handleSetReviewStatus, type ReviewHandlerDeps } from "@/lib/admin/review";
import { isPublicPath } from "@/lib/supabase/public-paths";

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return new Request(`http://localhost:3000/api/admin/sessions/${SESSION}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(caller: { userId: string; isAdmin: boolean } | null, over: Partial<ReviewHandlerDeps["store"]> = {}) {
  const store = {
    sessionExists: vi.fn(async () => true),
    setStatus: vi.fn(async () => ({ updatedAt: "2026-11-16T00:00:00Z" })),
    ...over,
  };
  return { d: { getCaller: async () => caller, store } satisfies ReviewHandlerDeps, store };
}

describe("isAdminClaims", () => {
  it("accepts only app_metadata.role = admin", () => {
    expect(isAdminClaims({ sub: ADMIN, app_metadata: { role: "admin" } })).toBe(true);
    expect(isAdminClaims({ sub: ADMIN, app_metadata: { role: "candidate" } })).toBe(false);
    expect(isAdminClaims({ sub: ADMIN, app_metadata: {} })).toBe(false);
    expect(isAdminClaims(null)).toBe(false);
  });

  it("ignores user_metadata, which users can edit themselves", () => {
    expect(isAdminClaims({ sub: ADMIN, user_metadata: { role: "admin" } })).toBe(false);
  });
});

describe("isReviewStatus", () => {
  it("knows the four statuses", () => {
    for (const s of ["pending", "in_progress", "completed", "rejected"]) expect(isReviewStatus(s)).toBe(true);
    expect(isReviewStatus("done")).toBe(false);
    expect(isReviewStatus(1)).toBe(false);
  });
});

describe("handleSetReviewStatus", () => {
  it("lets an admin set the status, recording who did it", async () => {
    const { d, store } = deps({ userId: ADMIN, isAdmin: true });
    const res = await handleSetReviewStatus(post({ status: "completed" }), SESSION, d);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, review: { sessionId: SESSION, status: "completed" } });
    expect(store.setStatus).toHaveBeenCalledWith(SESSION, "completed", ADMIN);
  });

  it("is 401 signed out and 403 for a candidate, without touching the store", async () => {
    const signedOut = deps(null);
    expect((await handleSetReviewStatus(post({ status: "completed" }), SESSION, signedOut.d)).status).toBe(401);
    const candidate = deps({ userId: ADMIN, isAdmin: false });
    expect((await handleSetReviewStatus(post({ status: "completed" }), SESSION, candidate.d)).status).toBe(403);
    expect(candidate.store.setStatus).not.toHaveBeenCalled();
    expect(candidate.store.sessionExists).not.toHaveBeenCalled();
  });

  it("rejects a bad id or status", async () => {
    const { d, store } = deps({ userId: ADMIN, isAdmin: true });
    expect((await handleSetReviewStatus(post({ status: "completed" }), "nope", d)).status).toBe(400);
    expect((await handleSetReviewStatus(post({ status: "done" }), SESSION, d)).status).toBe(400);
    expect((await handleSetReviewStatus(post("{bad"), SESSION, d)).status).toBe(400);
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it("is 404 for an unknown interview", async () => {
    const { d, store } = deps({ userId: ADMIN, isAdmin: true }, { sessionExists: vi.fn(async () => false) });
    expect((await handleSetReviewStatus(post({ status: "rejected" }), SESSION, d)).status).toBe(404);
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it("hides storage errors", async () => {
    const { d } = deps(
      { userId: ADMIN, isAdmin: true },
      { setStatus: vi.fn(async () => { throw new Error("db secret-detail"); }) },
    );
    const res = await handleSetReviewStatus(post({ status: "pending" }), SESSION, d);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail");
  });
});

describe("admin paths", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

  it("keeps /admin pages behind the login and lets only the review API answer for itself", () => {
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath(`/admin/sessions/${SESSION}`)).toBe(false);
    expect(isPublicPath(`/api/admin/sessions/${SESSION}/review`)).toBe(true);
    expect(isPublicPath(`/api/admin/sessions/${SESSION}`)).toBe(false);
    expect(isPublicPath("/api/admin/sessions/x/review")).toBe(false);
  });

  it("checks for an admin in the layout and in every admin page", () => {
    expect(read("app/admin/layout.tsx")).toContain("await requireAdmin()");
    expect(read("app/admin/page.tsx")).toContain("await requireAdmin()");
    expect(read("app/admin/sessions/[id]/page.tsx")).toContain("await requireAdmin()");
  });

  it("shows the recording, not the transcript or AI feedback, and only plays http(s) links", () => {
    const page = read("app/admin/sessions/[id]/page.tsx");
    expect(page).toContain("Interview recording");
    expect(page).not.toContain("AI feedback");
    expect(page).not.toContain('title="Transcript"');
    expect(read("lib/admin/data.ts")).toMatch(/recording_url && \/\^https\?:/);
  });
});

describe("interview_reviews migration", () => {
  const sql = readFileSync(
    fileURLToPath(new URL("../supabase/migrations/20261116000000_interview_reviews.sql", import.meta.url)),
    "utf8",
  )
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("is invisible to browsers (service role only)", () => {
    expect(sql).toContain("alter table public.interview_reviews enable row level security");
    expect(sql).toContain("revoke all on table public.interview_reviews from anon, authenticated");
    expect(sql).not.toMatch(/grant [a-z, ]* on table public\.interview_reviews to (authenticated|anon)/);
    expect(sql).toContain("check (status in ('pending', 'in_progress', 'completed', 'rejected'))");
  });
});
