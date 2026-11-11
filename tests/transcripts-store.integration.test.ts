import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  createSupabaseTranscriptStore,
  type StoreTranscriptInput,
} from "@/lib/transcripts/store";

/**
 * Runs against a real Supabase project, so it is skipped unless both variables
 * are set. Use a LOCAL stack (`make supabase-start`, `make db-reset`):
 *
 *   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
 *   SUPABASE_TEST_SECRET_KEY=<SERVICE_ROLE_KEY from `npx supabase status -o env`> \
 *   npx vitest run tests/transcripts-store.integration.test.ts
 *
 * It creates two throwaway users and deletes them (and their rows) afterwards.
 */
const URL_ = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_SECRET_KEY;

describe.skipIf(!URL_ || !KEY)("createSupabaseTranscriptStore (real database)", () => {
  let admin: SupabaseClient<Database>;
  let owner: string;
  let stranger: string;
  let interviewId: string;

  async function newUser(label: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email: `store-it-${label}-${randomUUID().slice(0, 8)}@example.test`,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return data.user.id;
  }

  async function newSession(over: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("interview_sessions")
      .insert({ interview_id: interviewId, user_id: owner, ...over })
      .select("id")
      .single();
    if (error) throw new Error(`insert session failed: ${error.message}`);
    return data.id;
  }

  const input = (sessionId: string, over: Partial<StoreTranscriptInput> = {}): StoreTranscriptInput => ({
    sessionId,
    userId: owner,
    transcript: [
      { role: "interviewer", text: "Q?" },
      { role: "candidate", text: "A." },
    ],
    metadata: { source: "client_gemini_live", durationSeconds: 42, endedReason: "user_ended" },
    endedAtIso: "2026-11-11T12:00:00.000Z",
    ...over,
  });

  beforeAll(async () => {
    admin = createClient<Database>(URL_!, KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    owner = await newUser("owner");
    stranger = await newUser("stranger");
    const { data, error } = await admin.rpc("save_generated_interview", {
      p_generation_id: randomUUID(),
      p_user_id: owner,
      p_questions: ["Q1", "Q2"],
    });
    if (error || !data) throw new Error(`save_generated_interview failed: ${error?.message}`);
    interviewId = data;
  });

  afterAll(async () => {
    // Deleting the users cascades to profiles, interviews, sessions and feedback.
    for (const id of [owner, stranger]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  it("stores once, then reports already_stored and keeps the first transcript", async () => {
    const store = createSupabaseTranscriptStore(admin);
    const sid = await newSession();
    expect(await store.storeOnce(input(sid))).toEqual({ kind: "stored", status: "completed" });
    expect(
      await store.storeOnce(input(sid, { transcript: [{ role: "candidate", text: "second" }] })),
    ).toEqual({ kind: "already_stored" });

    const { data } = await admin
      .from("interview_sessions")
      .select("status, transcript, transcript_source, duration_seconds, ended_reason")
      .eq("id", sid)
      .single();
    expect(data).toMatchObject({
      status: "completed",
      transcript_source: "client_gemini_live",
      duration_seconds: 42,
      ended_reason: "user_ended",
    });
    expect(data?.transcript).toHaveLength(2);
  });

  it("reports not_found for another user's session and for a missing one, and writes nothing", async () => {
    const store = createSupabaseTranscriptStore(admin);
    const sid = await newSession();
    expect(await store.storeOnce(input(sid, { userId: stranger }))).toEqual({ kind: "not_found" });
    expect(await store.storeOnce(input(randomUUID()))).toEqual({ kind: "not_found" });
    const { data } = await admin.from("interview_sessions").select("transcript").eq("id", sid).single();
    expect(data?.transcript).toBeNull();
  });

  it("abandons on an empty transcript but never downgrades a completed session", async () => {
    const store = createSupabaseTranscriptStore(admin);
    const open = await newSession();
    expect(await store.storeOnce(input(open, { transcript: [] }))).toEqual({
      kind: "stored",
      status: "abandoned",
    });
    const done = await newSession({ status: "completed" });
    expect(await store.storeOnce(input(done, { transcript: [] }))).toEqual({
      kind: "stored",
      status: "completed",
    });
  });

  it("lets exactly one of 8 parallel writes win", async () => {
    const store = createSupabaseTranscriptStore(admin);
    const sid = await newSession();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.storeOnce(input(sid, { transcript: [{ role: "candidate", text: `writer ${i}` }] })),
      ),
    );
    expect(outcomes.filter((o) => o.kind === "stored")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "already_stored")).toHaveLength(7);
  });
});
