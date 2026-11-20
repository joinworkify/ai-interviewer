import { MAX_RECORDING_BYTES, RECORDING_TYPES } from "./recording";

export type UploadRecordingOutcome = "uploaded" | "skipped" | "failed";

/**
 * Browser upload of an interview recording: ask the server for a presigned
 * URL, PUT the audio straight to storage, then confirm. Never throws and never
 * logs anything about the audio. `skipped` means there was nothing valid to
 * send (empty, too big, or a type the server does not accept).
 */
export async function uploadRecording(args: {
  sessionId: string;
  audio: Blob;
  fetchImpl?: typeof fetch;
}): Promise<UploadRecordingOutcome> {
  const { audio } = args;
  if (audio.size < 1 || audio.size > MAX_RECORDING_BYTES || !Object.hasOwn(RECORDING_TYPES, audio.type)) {
    return "skipped";
  }
  const doFetch = args.fetchImpl ?? fetch;
  const base = `/api/sessions/${encodeURIComponent(args.sessionId)}/recording`;
  try {
    const start = await doFetch(`${base}/upload-url`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: audio.type, size: audio.size }),
    });
    if (!start.ok) return "failed";
    const body: unknown = await start.json().catch(() => null);
    const upload = (body as { upload?: { url?: unknown; headers?: Record<string, string> } } | null)?.upload;
    if (typeof upload?.url !== "string") return "failed";

    const put = await doFetch(upload.url, { method: "PUT", headers: upload.headers, body: audio });
    if (!put.ok) return "failed";

    const confirm = await doFetch(`${base}/confirm`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    return confirm.ok ? "uploaded" : "failed";
  } catch {
    return "failed";
  }
}
