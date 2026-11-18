import { beforeEach, describe, expect, it, vi } from "vitest";

import { attemptsTowardLimit } from "@/lib/candidate/attempts";
import { handleReportProblem, type ProblemReportStore } from "@/lib/candidate/problem-reports";

const USER = "11111111-2222-4333-8444-555555555555";
const SID = "22222222-2222-4222-8222-222222222222";

function post(body: unknown) {
  return new Request(`http://localhost/api/candidate/attempts/${SID}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let add: ReturnType<typeof vi.fn<ProblemReportStore["add"]>>;
const deps = (userId: string | null = USER) => ({ getUserId: async () => userId, problemReports: { add } });

beforeEach(() => {
  add = vi.fn<ProblemReportStore["add"]>(async () => "saved");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handleReportProblem", () => {
  it("saves a report for the signed-in user's own interview", async () => {
    const res = await handleReportProblem(post({ kind: "lost_internet", message: "  Wi-Fi dropped  " }), SID, deps());
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledWith(USER, SID, "lost_internet", "Wi-Fi dropped");
  });

  it("rejects signed-out users, bad ids, unknown kinds and long messages before saving", async () => {
    expect((await handleReportProblem(post({ kind: "other", message: "" }), SID, deps(null))).status).toBe(401);
    expect((await handleReportProblem(post({ kind: "other", message: "" }), "nope", deps())).status).toBe(404);
    expect((await handleReportProblem(post({ kind: "hacked", message: "" }), SID, deps())).status).toBe(400);
    expect((await handleReportProblem(post({ kind: "other", message: "x".repeat(1001) }), SID, deps())).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it("says not found for someone else's interview and stops after the report limit", async () => {
    add.mockResolvedValueOnce("not_found");
    expect((await handleReportProblem(post({ kind: "audio", message: "" }), SID, deps())).status).toBe(404);
    add.mockResolvedValueOnce("limit");
    expect((await handleReportProblem(post({ kind: "audio", message: "" }), SID, deps())).status).toBe(429);
  });
});

describe("attemptsTowardLimit", () => {
  it("gives one free retry after a dropped interview; later drops count", () => {
    expect(attemptsTowardLimit([])).toBe(0);
    expect(attemptsTowardLimit(["user_ended", "interviewer_ended"])).toBe(2);
    expect(attemptsTowardLimit(["error"])).toBe(0);
    expect(attemptsTowardLimit(["error", "user_ended", "user_ended"])).toBe(2);
    expect(attemptsTowardLimit(["error", "error", "user_ended"])).toBe(2);
    expect(attemptsTowardLimit(["error", "error", "error", "error"])).toBe(3);
  });
});
