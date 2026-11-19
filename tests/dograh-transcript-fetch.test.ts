import { describe, expect, it, vi } from "vitest";

import { fetchTranscriptText } from "@/lib/dograh/transcript-fetch";

import { API_ORIGIN, STORAGE_ORIGIN, TRANSCRIPT_URL } from "./helpers/dograh";

const SIGNED = `${STORAGE_ORIGIN}/dograh/transcripts/7.txt?X-Amz-Signature=abc`;

const base = { apiOrigin: API_ORIGIN, storageOrigin: STORAGE_ORIGIN };

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe("fetchTranscriptText", () => {
  it("downloads a transcript served directly from the API origin", async () => {
    const fetchImpl = vi.fn(async () => new Response("assistant: hi\n"));
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: true, text: "assistant: hi\n" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls as unknown[][])[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("follows the one redirect to the configured storage origin", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect(SIGNED))
      .mockResolvedValueOnce(new Response("user: hello\n"));
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl });
    expect(r).toEqual({ ok: true, text: "user: hello\n" });
    expect(fetchImpl.mock.calls[1][0]).toBe(SIGNED);
  });

  it("follows a relative redirect that stays on the API origin", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect("/files/7.txt"))
      .mockResolvedValueOnce(new Response("ok"));
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl });
    expect(r.ok).toBe(true);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${API_ORIGIN}/files/7.txt`);
  });

  it("refuses a URL on another origin without making any request", async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example/transcript",
      "http://localhost:8001/transcript",
      `${API_ORIGIN.replace("localhost", "localhost.evil.example")}/x`,
    ]) {
      expect(await fetchTranscriptText(url, { ...base, fetchImpl })).toEqual({
        ok: false,
        reason: "foreign_origin",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["not a url"],
    ["file:///etc/passwd"],
    ["http://user:pw@localhost:8000/x"],
    [`${API_ORIGIN}/${"a".repeat(3000)}`],
  ])("refuses an invalid URL (%#)", async (url) => {
    const fetchImpl = vi.fn();
    expect(await fetchTranscriptText(url, { ...base, fetchImpl })).toEqual({
      ok: false,
      reason: "invalid_url",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not follow a redirect to another origin", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect("http://169.254.169.254/latest/"));
    expect(await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl })).toEqual({
      ok: false,
      reason: "foreign_origin",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect to storage when no storage origin is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect(SIGNED));
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { apiOrigin: API_ORIGIN, fetchImpl });
    expect(r).toEqual({ ok: false, reason: "foreign_origin" });
  });

  it("stops after one redirect", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect(SIGNED))
      .mockResolvedValueOnce(redirect(`${STORAGE_ORIGIN}/again`));
    expect(await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl })).toEqual({
      ok: false,
      reason: "http_error",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails on a non-200 answer", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    expect(await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl: fetchImpl as never })).toEqual({
      ok: false,
      reason: "http_error",
    });
  });

  it("rejects a body over the byte cap, declared or streamed", async () => {
    const declared = vi.fn(
      async () => new Response("x", { headers: { "content-length": "999999" } }),
    );
    expect(
      await fetchTranscriptText(TRANSCRIPT_URL, { ...base, maxBytes: 1000, fetchImpl: declared as never }),
    ).toEqual({ ok: false, reason: "too_large" });

    const streamed = vi.fn(async () => new Response("y".repeat(5000)));
    expect(
      await fetchTranscriptText(TRANSCRIPT_URL, { ...base, maxBytes: 1000, fetchImpl: streamed as never }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("times out a request that never answers", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { ...base, timeoutMs: 20, fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports a network failure without the error text", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED ${TRANSCRIPT_URL}`);
    });
    const r = await fetchTranscriptText(TRANSCRIPT_URL, { ...base, fetchImpl: fetchImpl as never });
    expect(r).toEqual({ ok: false, reason: "network" });
    expect(JSON.stringify(r)).not.toContain("PUBLIC-TOKEN");
  });
});
