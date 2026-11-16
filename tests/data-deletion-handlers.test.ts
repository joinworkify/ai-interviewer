import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleDeleteAccount,
  handleDeleteSession,
  handleDeleteTranscript,
  type DeletionHandlerDeps,
} from "@/lib/data-deletion/handlers";
import { DeletionStoreError, type DeletionStore } from "@/lib/data-deletion/store";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "22222222-2222-4222-8222-222222222222";

class FakeStore implements DeletionStore {
  calls: string[] = [];
  /** Session ids that exist and belong to ME. */
  owned = new Set([SID]);
  fail = false;
  async deleteTranscript(userId: string, sessionId: string) {
    this.calls.push(`transcript:${userId}:${sessionId}`);
    if (this.fail) throw new DeletionStoreError("boom secret-detail");
    return this.owned.has(sessionId);
  }
  async deleteSession(userId: string, sessionId: string) {
    this.calls.push(`session:${userId}:${sessionId}`);
    if (this.fail) throw new DeletionStoreError("boom secret-detail");
    return this.owned.has(sessionId);
  }
  async deleteAccount(userId: string) {
    this.calls.push(`account:${userId}`);
    if (this.fail) throw new DeletionStoreError("boom secret-detail");
  }
}

let store: FakeStore;
let userId: string | null;
let after: ReturnType<typeof vi.fn>;

function deps(over: Partial<DeletionHandlerDeps> = {}): DeletionHandlerDeps {
  return { getUserId: async () => userId, store, afterAccountDeleted: after, ...over };
}

function del(body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/account/data", {
    method: "DELETE",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  store = new FakeStore();
  userId = ME;
  after = vi.fn(async () => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each([
  ["handleDeleteTranscript", handleDeleteTranscript, "transcript"],
  ["handleDeleteSession", handleDeleteSession, "session"],
] as const)("%s", (_name, handler, kind) => {
  it("deletes an owned session for the verified user", async () => {
    const res = await handler(SID, deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ success: true, deleted: kind });
    expect(store.calls).toEqual([`${kind}:${ME}:${SID}`]);
  });

  it("answers 401 without touching the store when signed out", async () => {
    userId = null;
    const res = await handler(SID, deps());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(store.calls).toEqual([]);
  });

  it("answers 404 for a malformed id without touching the store", async () => {
    const res = await handler("not-a-uuid", deps());
    expect(res.status).toBe(404);
    expect(store.calls).toEqual([]);
  });

  it("answers the same 404 for a missing session and for one the user does not own", async () => {
    store.owned.clear();
    const missing = await handler(SID, deps());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      success: false,
      error: "not_found",
      message: "Not found.",
    });
  });

  it("hides storage details behind storage_failed", async () => {
    store.fail = true;
    const res = await handler(SID, deps());
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("storage_failed");
    expect(text).not.toContain("secret-detail");
  });
});

describe("handleDeleteAccount", () => {
  const confirm = { confirm: "delete-my-data" };

  it("deletes the verified user's account after confirmation, then runs the cleanup hook", async () => {
    const res = await handleDeleteAccount(del(confirm), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, deleted: "account" });
    expect(store.calls).toEqual([`account:${ME}`]);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("never takes the user id from the body", async () => {
    const res = await handleDeleteAccount(del({ ...confirm, userId: "other" }), deps());
    expect(res.status).toBe(400);
    expect(store.calls).toEqual([]);
  });

  it("answers 401 when signed out", async () => {
    userId = null;
    expect((await handleDeleteAccount(del(confirm), deps())).status).toBe(401);
    expect(store.calls).toEqual([]);
  });

  it.each([
    ["no body", undefined],
    ["an empty object", {}],
    ["the wrong phrase", { confirm: "yes" }],
    ["a non-string confirmation", { confirm: true }],
    ["an unknown key", { confirm: "delete-my-data", extra: 1 }],
    ["an array", [confirm]],
  ])("answers 400 and deletes nothing for %s", async (_n, body) => {
    const res = await handleDeleteAccount(del(body), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(store.calls).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and a wrong content type", async () => {
    expect((await handleDeleteAccount(del("{not json"), deps())).status).toBe(400);
    const wrongType = new Request("http://localhost/x", {
      method: "DELETE",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(confirm),
    });
    expect((await handleDeleteAccount(wrongType, deps())).status).toBe(415);
    expect(store.calls).toEqual([]);
  });

  it("rejects an oversized body", async () => {
    const res = await handleDeleteAccount(del({ ...confirm, pad: "x".repeat(5000) }), deps());
    expect(res.status).toBe(413);
    expect(store.calls).toEqual([]);
  });

  it("reports storage_failed, hides the cause and skips the cleanup hook", async () => {
    store.fail = true;
    const res = await handleDeleteAccount(del(confirm), deps());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail");
    expect(after).not.toHaveBeenCalled();
  });

  it("still answers 200 when the cleanup hook fails (the account is already gone)", async () => {
    after.mockRejectedValueOnce(new Error("signOut failed secret-detail"));
    const res = await handleDeleteAccount(del(confirm), deps());
    expect(res.status).toBe(200);
  });

  it("deletes the user's files (resumes in S3) before the account", async () => {
    const order: string[] = [];
    const deleteUserFiles = vi.fn(async (id: string) => {
      order.push(`files:${id}`, ...store.calls);
    });
    const res = await handleDeleteAccount(del(confirm), deps({ deleteUserFiles }));
    expect(res.status).toBe(200);
    expect(order).toEqual([`files:${ME}`]);
    expect(store.calls).toEqual([`account:${ME}`]);
  });

  it("keeps the account when the files cannot be deleted, so it can be retried", async () => {
    const deleteUserFiles = vi.fn(async () => {
      throw new Error("s3 down secret-detail");
    });
    const res = await handleDeleteAccount(del(confirm), deps({ deleteUserFiles }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail");
    expect(store.calls).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });
});
