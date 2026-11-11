import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  TranscriptStoreError,
  createSupabaseTranscriptStore,
} from "@/lib/transcripts/store";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "22222222-2222-4222-8222-222222222222";

const input = {
  sessionId: SID,
  userId: ME,
  transcript: [{ role: "candidate" as const, text: "hi" }],
  metadata: {
    source: "client_gemini_live" as const,
    durationSeconds: 12,
    endedReason: "user_ended" as const,
  },
  endedAtIso: "2026-11-11T12:00:00.000Z",
};

function fakeAdmin(opts: {
  rpc: { data: unknown; error: { message: string } | null };
  lookup?: { data: unknown; error: { message: string } | null };
}) {
  const eq = vi.fn();
  const chain = {
    select: vi.fn(() => chain),
    eq: eq.mockImplementation(() => chain),
    maybeSingle: vi.fn(async () => opts.lookup ?? { data: null, error: null }),
  };
  const rpc = vi.fn(async () => opts.rpc);
  const from = vi.fn(() => chain);
  return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from, eq };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("createSupabaseTranscriptStore", () => {
  it("calls the set-once function with the user id and canonical data", async () => {
    const { client, rpc, from } = fakeAdmin({
      rpc: { data: [{ id: SID, status: "completed" }], error: null },
    });
    const outcome = await createSupabaseTranscriptStore(client).storeOnce(input);
    expect(outcome).toEqual({ kind: "stored", status: "completed" });
    expect(rpc).toHaveBeenCalledWith("store_session_transcript", {
      p_session_id: SID,
      p_user_id: ME,
      p_transcript: input.transcript,
      p_source: "client_gemini_live",
      p_duration_seconds: 12,
      p_ended_reason: "user_ended",
      p_ended_at: input.endedAtIso,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("reports abandoned when the function says so", async () => {
    const { client } = fakeAdmin({
      rpc: { data: [{ id: SID, status: "abandoned" }], error: null },
    });
    expect(await createSupabaseTranscriptStore(client).storeOnce(input)).toEqual({
      kind: "stored",
      status: "abandoned",
    });
  });

  it("zero rows and the user's session exists: already stored", async () => {
    const { client, eq } = fakeAdmin({
      rpc: { data: [], error: null },
      lookup: { data: { id: SID }, error: null },
    });
    expect(await createSupabaseTranscriptStore(client).storeOnce(input)).toEqual({
      kind: "already_stored",
    });
    // The follow-up read is scoped to the user too.
    expect(eq).toHaveBeenCalledWith("user_id", ME);
  });

  it("zero rows and no such session for this user: not found", async () => {
    const { client } = fakeAdmin({ rpc: { data: [], error: null } });
    expect(await createSupabaseTranscriptStore(client).storeOnce(input)).toEqual({
      kind: "not_found",
    });
  });

  it("throws a generic error without echoing database text", async () => {
    const { client } = fakeAdmin({ rpc: { data: null, error: { message: "boom hi" } } });
    await expect(createSupabaseTranscriptStore(client).storeOnce(input)).rejects.toBeInstanceOf(
      TranscriptStoreError,
    );
    await expect(createSupabaseTranscriptStore(client).storeOnce(input)).rejects.toThrow(
      "storeOnce failed",
    );
  });
});

describe("20261111000003_ai_transcript_persistence.sql", () => {
  const FILE = fileURLToPath(
    new URL("../supabase/migrations/20261111000003_ai_transcript_persistence.sql", import.meta.url),
  );
  const sql = readFileSync(FILE, "utf8")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("adds the three columns only if missing", () => {
    expect(sql).toContain(
      "add column if not exists transcript_source text, add column if not exists duration_seconds int, add column if not exists ended_reason text",
    );
  });

  it("constrains transcript_source with a named, re-creatable check", () => {
    expect(sql).toContain(
      "drop constraint if exists interview_sessions_transcript_source_check",
    );
    expect(sql).toContain(
      "add constraint interview_sessions_transcript_source_check check (transcript_source in ('client_gemini_live'))",
    );
  });

  it("writes with one guarded update: id, user and no existing transcript", () => {
    expect(sql).toContain("create or replace function public.store_session_transcript(");
    expect(sql).toMatch(
      /where s\.id = p_session_id and s\.user_id = p_user_id and s\.transcript is null returning s\.id, s\.status/,
    );
    expect(sql.match(/update public\.interview_sessions/g)).toHaveLength(1);
  });

  it("can only complete or abandon, never set in_progress", () => {
    expect(sql).toMatch(/when s\.status = 'completed' then 'completed'/);
    expect(sql).toMatch(/when jsonb_array_length\(p_transcript\) = 0 then 'abandoned'/);
    expect(sql).not.toMatch(/status = 'in_progress'/);
    expect(sql).not.toMatch(/then 'in_progress'|else 'in_progress'/);
  });

  it("is executable by the service role only", () => {
    expect(sql).toMatch(/revoke all on function public\.store_session_transcript\( uuid, uuid, jsonb, text, int, text, timestamptz \) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.store_session_transcript\( uuid, uuid, jsonb, text, int, text, timestamptz \) to service_role/);
    expect(sql.match(/grant execute/g)).toHaveLength(1);
  });

  it("changes no RLS, policy or table grant", () => {
    expect(sql).not.toMatch(/create policy|drop policy|enable row level security|grant (select|insert|update|delete|all) on table/);
  });
});
