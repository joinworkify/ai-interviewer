import { describe, expect, it, vi } from "vitest";

import { csvCell, toCsv } from "@/lib/admin/csv";
import { applyListQuery, listQueryString, parseListQuery, type ListRow } from "@/lib/admin/list-query";
import { handleAssign, handleBulkReview, handleNote, MAX_BULK, type WorkflowDeps } from "@/lib/admin/workflow";
import type { ReviewHandlerDeps } from "@/lib/admin/review";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";
const req = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("csv", () => {
  it("quotes cells that need it", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(82)).toBe("82");
  });
  it("neutralizes spreadsheet formulas typed by candidates", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell("normal -text")).toBe("normal -text");
  });
  it("joins rows with CRLF", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

const row = (o: Partial<ListRow> & { score: number | null }): ListRow => ({
  name: "N", email: "n@x.io", reviewStatus: "pending", assignedTo: null, startedAt: "2026-01-01", ...o,
});

describe("list query", () => {
  it("parses safely and falls back to defaults", () => {
    expect(parseListQuery({})).toEqual({ status: null, q: "", minScore: null, sort: "newest", assigned: null });
    expect(parseListQuery({ status: "nope", minScore: "abc", sort: "evil", q: "  Ann " })).toEqual({ status: null, q: "ann", minScore: null, sort: "newest", assigned: null });
    expect(parseListQuery({ minScore: "250" }).minScore).toBe(100);
    expect(parseListQuery({ status: "accepted", assigned: "me" })).toMatchObject({ status: "accepted", assigned: "me" });
  });
  const rows = [
    row({ name: "Low", score: 40 }),
    row({ name: "None", score: null }),
    row({ name: "High", score: 90, reviewStatus: "accepted", assignedTo: A }),
    row({ name: "Mid", score: 70, assignedTo: B }),
  ];
  const q = (p: Record<string, string>) => parseListQuery(p);
  it("filters by minimum score, hiding unscored ones", () => {
    expect(applyListQuery(rows, q({ minScore: "50" }), A).map((r) => r.name)).toEqual(["High", "Mid"]);
  });
  it("sorts by score with unscored last either way", () => {
    expect(applyListQuery(rows, q({ sort: "score_desc" }), A).map((r) => r.name)).toEqual(["High", "Mid", "Low", "None"]);
    expect(applyListQuery(rows, q({ sort: "score_asc" }), A).map((r) => r.name)).toEqual(["Low", "Mid", "High", "None"]);
  });
  it("filters by assignee: me, none or a specific admin", () => {
    expect(applyListQuery(rows, q({ assigned: "me" }), A).map((r) => r.name)).toEqual(["High"]);
    expect(applyListQuery(rows, q({ assigned: "none" }), A).map((r) => r.name)).toEqual(["Low", "None"]);
    expect(applyListQuery(rows, q({ assigned: B }), A).map((r) => r.name)).toEqual(["Mid"]);
    // "me" with no signed-in id matches nothing rather than every unassigned row.
    expect(applyListQuery(rows, q({ assigned: "me" }), null)).toEqual([]);
  });
  it("combines status and search", () => {
    expect(applyListQuery(rows, q({ status: "accepted", q: "hig" }), A).map((r) => r.name)).toEqual(["High"]);
  });
  it("keeps the query string without defaults", () => {
    expect(listQueryString({ q: "a", sort: "score_desc", page: "3" })).toBe("q=a&sort=score_desc");
    expect(listQueryString({ q: "a" }, { q: null })).toBe("");
  });
});

function reviewDeps(over: { caller?: { userId: string; isAdmin: boolean } | null; existing?: string[] } = {}) {
  const setStatus = vi.fn(async () => ({ updatedAt: "t" }));
  const onStatusSet = vi.fn();
  const existing = over.existing ?? [S1, S2];
  const deps: ReviewHandlerDeps = {
    getCaller: async () => (over.caller === undefined ? { userId: A, isAdmin: true } : over.caller),
    store: { sessionExists: async (id) => existing.includes(id), setStatus },
    onStatusSet,
  };
  return { deps, setStatus, onStatusSet };
}

describe("handleBulkReview", () => {
  it("sets each status, records the admin and passes the email choice to the hook", async () => {
    const t = reviewDeps();
    const res = await handleBulkReview(req("POST", { ids: [S1, S2, S1], status: "accepted", notify: true }), t.deps);
    expect(await res.json()).toEqual({ success: true, updated: 2, missing: 0 });
    expect(t.setStatus).toHaveBeenCalledTimes(2);
    expect(t.setStatus).toHaveBeenCalledWith(S1, "accepted", A);
    expect(t.onStatusSet).toHaveBeenCalledWith({ sessionId: S2, status: "accepted", notify: true });
  });
  it("skips unknown sessions and never emails unless asked", async () => {
    const t = reviewDeps({ existing: [S1] });
    const res = await handleBulkReview(req("POST", { ids: [S1, S2], status: "rejected" }), t.deps);
    expect(await res.json()).toMatchObject({ updated: 1, missing: 1 });
    expect(t.onStatusSet).toHaveBeenCalledWith({ sessionId: S1, status: "rejected", notify: false });
  });
  it.each([
    ["signed out", { caller: null }, { ids: [S1], status: "accepted" }, 401],
    ["not an admin", { caller: { userId: A, isAdmin: false } }, { ids: [S1], status: "accepted" }, 403],
    ["no ids", {}, { ids: [], status: "accepted" }, 400],
    ["too many ids", {}, { ids: Array.from({ length: MAX_BULK + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), status: "accepted" }, 400],
    ["a bad id", {}, { ids: ["nope"], status: "accepted" }, 400],
    ["a bad status", {}, { ids: [S1], status: "hired" }, 400],
  ])("rejects %s", async (_l, over, body, status) => {
    const t = reviewDeps(over as never);
    expect((await handleBulkReview(req("POST", body), t.deps)).status).toBe(status);
    expect(t.setStatus).not.toHaveBeenCalled();
  });
});

function workflowDeps(over: { caller?: { userId: string; isAdmin: boolean } | null; admins?: string[]; ownNote?: boolean } = {}) {
  const setAssignee = vi.fn(async () => {});
  const add = vi.fn(async () => ({ id: "n1", createdAt: "t" }));
  const removeOwn = vi.fn(async () => over.ownNote ?? true);
  const deps: WorkflowDeps = {
    getCaller: async () => (over.caller === undefined ? { userId: A, isAdmin: true } : over.caller),
    assign: { sessionExists: async (id) => id === S1, isAdminUser: async (id) => (over.admins ?? [A, B]).includes(id), setAssignee },
    notes: { sessionExists: async (id) => id === S1, authorName: async () => "admin@x.io", add, removeOwn },
  };
  return { deps, setAssignee, add, removeOwn };
}

describe("handleAssign", () => {
  it("assigns to an admin, or clears with null", async () => {
    const t = workflowDeps();
    expect((await handleAssign(req("POST", { adminId: B }), S1, t.deps)).status).toBe(200);
    expect(t.setAssignee).toHaveBeenCalledWith(S1, B);
    await handleAssign(req("POST", { adminId: null }), S1, t.deps);
    expect(t.setAssignee).toHaveBeenLastCalledWith(S1, null);
  });
  it.each([
    ["a non-admin target", { admins: [A] }, { adminId: B }, 400],
    ["a malformed id", {}, { adminId: "x" }, 400],
    ["a missing field", {}, {}, 400],
    ["not an admin caller", { caller: { userId: A, isAdmin: false } }, { adminId: B }, 403],
  ])("rejects %s", async (_l, over, body, status) => {
    const t = workflowDeps(over as never);
    expect((await handleAssign(req("POST", body), S1, t.deps)).status).toBe(status);
    expect(t.setAssignee).not.toHaveBeenCalled();
  });
  it("answers 404 for an unknown interview", async () => {
    expect((await handleAssign(req("POST", { adminId: B }), S2, workflowDeps().deps)).status).toBe(404);
  });
});

describe("handleNote", () => {
  it("adds a trimmed note under the admin's name", async () => {
    const t = workflowDeps();
    const res = await handleNote(req("POST", { body: "  Strong on SQL.\r\nWeak on stats.  " }), S1, t.deps);
    expect(res.status).toBe(201);
    expect(t.add).toHaveBeenCalledWith({ sessionId: S1, authorId: A, authorName: "admin@x.io", body: "Strong on SQL.\nWeak on stats." });
  });
  it.each([
    ["an empty note", { body: "   " }],
    ["a huge note", { body: "x".repeat(2001) }],
    ["no body", {}],
  ])("rejects %s", async (_l, body) => {
    const t = workflowDeps();
    expect((await handleNote(req("POST", body), S1, t.deps)).status).toBe(400);
    expect(t.add).not.toHaveBeenCalled();
  });
  it("lets an admin delete only their own note", async () => {
    const own = workflowDeps({ ownNote: true });
    expect((await handleNote(req("DELETE", { noteId: S2 }), S1, own.deps)).status).toBe(200);
    expect(own.removeOwn).toHaveBeenCalledWith(S2, A);
    expect((await handleNote(req("DELETE", { noteId: S2 }), S1, workflowDeps({ ownNote: false }).deps)).status).toBe(404);
  });
  it("is admins only", async () => {
    expect((await handleNote(req("POST", { body: "x" }), S1, workflowDeps({ caller: { userId: A, isAdmin: false } }).deps)).status).toBe(403);
    expect((await handleNote(req("POST", { body: "x" }), S1, workflowDeps({ caller: null }).deps)).status).toBe(401);
  });
});
