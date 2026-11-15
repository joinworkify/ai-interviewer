import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/supabase/public-paths";

const ID = "22222222-2222-4222-8222-222222222222";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/auth/login",
    "/auth/sign-up",
    "/auth/confirm",
    "/auth",
    "/api/vapi/generate-interview",
    "/api/gemini-live/token",
    "/api/account/data",
    "/api/dograh/session",
    "/api/dograh/webhook",
    "/api/candidate/attempts",
    `/api/candidate/attempts/${ID}`,
    "/api/sessions",
    `/api/sessions/${ID}`,
    `/api/sessions/${ID}/transcript`,
    `/api/sessions/${ID}/feedback`,
    `/api/sessions/${ID.toUpperCase()}`,
  ])("lets %s through", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    // Look-alikes of the sign-in flow.
    "/authx",
    "/authentication",
    "/login",
    "/login/extra",
    // Prefix matches that the old startsWith rules allowed.
    "/api/sessionsX",
    "/api/sessions/",
    "/api/sessions/abc",
    "/api/sessions/abc/transcript",
    `/api/sessions/${ID}/other`,
    `/api/sessions/${ID}/transcript/extra`,
    `/api/sessions/${ID}/`,
    `/api/sessions/${ID.slice(0, 35)}`,
    // Exact paths do not grow children or siblings.
    "/api/dograh",
    "/api/dograh/",
    "/api/dograh/other",
    "/api/dograh/session/",
    "/api/dograh/webhookx",
    "/api/vapi/webhook",
    "/api/vapi/generate-interview/extra",
    "/api/gemini-live/tokenx",
    "/api/account",
    "/api/account/data/extra",
    "/api/candidate",
    "/api/candidate/attempts/",
    "/api/candidate/attempts/abc",
    `/api/candidate/attempts/${ID}/more`,
    // The product pages, staff and cron routes always need a session.
    "/candidate/roles",
    "/protected",
    "/staff",
    "/api/staff/settings",
    "/api/cron/retention",
    "/api/interviews/capability",
  ])("does not let %s through", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
