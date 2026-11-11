import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseDeletionStore, DeletionStoreError } from "@/lib/data-deletion/store";

import { fakeClient } from "./helpers/fake-supabase";

const ME = "11111111-1111-4111-8111-111111111111";
const SID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const found = (q: { op: string }) => ({ data: q.op === "select" ? { id: SID } : null, error: null });
const notFound = () => ({ data: null, error: null });

describe("deleteTranscript", () => {
  it("purges vapi events, then clears transcript and recording for that user's session only", async () => {
    const { client, log, events } = fakeClient(found);
    const ok = await createSupabaseDeletionStore(client).deleteTranscript(ME, SID);
    expect(ok).toBe(true);
    expect(events).toEqual(["interview_sessions:select", "rpc:purge_vapi_events", "interview_sessions:update"]);
    expect(log[0].filters).toEqual({ id: SID, user_id: ME });
    expect(log[1].payload).toEqual({ p_user_id: ME, p_session_id: SID });
    expect(log[2].payload).toEqual({ transcript: null, recording_url: null });
    expect(log[2].filters).toEqual({ id: SID, user_id: ME });
  });

  it("does not touch feedback", async () => {
    const { client, log } = fakeClient(found);
    await createSupabaseDeletionStore(client).deleteTranscript(ME, SID);
    expect(log.some((q) => q.table === "feedback")).toBe(false);
  });

  it("returns false and changes nothing when the session is not the user's", async () => {
    const { client, events } = fakeClient(notFound);
    expect(await createSupabaseDeletionStore(client).deleteTranscript(ME, SID)).toBe(false);
    expect(events).toEqual(["interview_sessions:select"]);
  });

  it("leaves the transcript in place if the purge fails", async () => {
    const { client, events } = fakeClient(found, { rpc: () => ({ data: null, error: { message: "rpc down" } }) });
    await expect(createSupabaseDeletionStore(client).deleteTranscript(ME, SID)).rejects.toBeInstanceOf(DeletionStoreError);
    expect(events).not.toContain("interview_sessions:update");
  });
});

describe("deleteSession", () => {
  it("purges vapi events first, then deletes the session scoped to the user", async () => {
    const { client, log, events } = fakeClient(found);
    expect(await createSupabaseDeletionStore(client).deleteSession(ME, SID)).toBe(true);
    expect(events).toEqual(["interview_sessions:select", "rpc:purge_vapi_events", "interview_sessions:delete"]);
    expect(log[2].filters).toEqual({ id: SID, user_id: ME });
  });

  it("returns false for a session the user does not own", async () => {
    const { client, events } = fakeClient(notFound);
    expect(await createSupabaseDeletionStore(client).deleteSession(ME, SID)).toBe(false);
    expect(events).toEqual(["interview_sessions:select"]);
  });

  it("keeps the session if the purge fails", async () => {
    const { client, events } = fakeClient(found, { rpc: () => ({ data: null, error: { message: "x" } }) });
    await expect(createSupabaseDeletionStore(client).deleteSession(ME, SID)).rejects.toBeInstanceOf(DeletionStoreError);
    expect(events).not.toContain("interview_sessions:delete");
  });
});

describe("deleteAccount", () => {
  it("purges all of the user's vapi events before deleting the auth user", async () => {
    const { client, log, events } = fakeClient(notFound);
    await createSupabaseDeletionStore(client).deleteAccount(ME);
    expect(events).toEqual(["rpc:purge_vapi_events", "auth.deleteUser"]);
    expect(log[0].payload).toEqual({ p_user_id: ME, p_session_id: null });
    expect(log[1].filters).toEqual({ id: ME });
  });

  it("does not delete the user if the purge fails, so nothing is orphaned", async () => {
    const { client, events } = fakeClient(notFound, { rpc: () => ({ data: null, error: { message: "x" } }) });
    await expect(createSupabaseDeletionStore(client).deleteAccount(ME)).rejects.toBeInstanceOf(DeletionStoreError);
    expect(events).not.toContain("auth.deleteUser");
  });

  it("surfaces an auth deletion failure without leaking its message", async () => {
    const { client } = fakeClient(notFound, { deleteUser: () => ({ error: { message: "secret-detail" } }) });
    const err = await createSupabaseDeletionStore(client).deleteAccount(ME).catch((e: Error) => e);
    expect(err).toBeInstanceOf(DeletionStoreError);
    expect((err as Error).message).not.toContain("secret-detail");
  });
});
