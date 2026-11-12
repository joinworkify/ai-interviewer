import type { TranscriptSource } from "./types";

/** Browsers cap a keepalive request body at 64 KiB; stay under it. */
const KEEPALIVE_MAX_BYTES = 60_000;

export type SaveTranscriptOutcome = "stored" | "already_stored" | "failed";

/**
 * Browser call to PUT /api/sessions/:id/transcript. Never throws and never
 * logs the transcript. `keepalive` lets the request survive a tab close.
 */
export async function putTranscript(args: {
  sessionId: string;
  source: TranscriptSource;
  payload: unknown;
  fetchImpl?: typeof fetch;
}): Promise<SaveTranscriptOutcome> {
  const body = JSON.stringify({ source: args.source, payload: args.payload });
  const doFetch = args.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`/api/sessions/${encodeURIComponent(args.sessionId)}/transcript`, {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body,
      keepalive: new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BYTES,
    });
    if (res.ok) return "stored";
    return res.status === 409 ? "already_stored" : "failed";
  } catch {
    return "failed";
  }
}
