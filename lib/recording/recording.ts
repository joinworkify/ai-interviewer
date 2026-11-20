import { jsonResponse, readJsonBody } from "@/lib/http/json";
import type { ResumeStorage } from "@/lib/candidate/resume";
import { isUuid } from "@/lib/sessions/validation";

/**
 * Audio recording of an interview, uploaded by the candidate's browser when
 * the call ends. Same shape as the resume upload: the file goes straight to S3
 * through a short-lived presigned URL, so it never passes through this server.
 *
 *   1. POST /api/sessions/:id/recording/upload-url { contentType, size }
 *      -> records a 'pending' row, returns a presigned PUT URL.
 *   2. The browser PUTs the audio to that URL with the given Content-Type.
 *   3. POST /api/sessions/:id/recording/confirm
 *      -> checks the object in S3 matches, marks the row 'uploaded'.
 *
 * Framework-agnostic (Request -> Response) with injected dependencies. The
 * user id comes only from verified Supabase claims. Only the signed-in owner
 * of a session can attach audio to it, and only once.
 */

/** About 25 minutes of Opus at 64 kbps; the session itself is capped far lower. */
export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
export const RECORDING_URL_TTL_SECONDS = 300;
const MAX_BODY_BYTES = 512;

/** Allowed types (no codec parameter) and the extension each is stored under. */
export const RECORDING_TYPES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export interface RecordingRow {
  session_id: string;
  user_id: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "uploaded";
}

export interface RecordingStore {
  /** True when the session exists and belongs to the user. */
  ownsSession(userId: string, sessionId: string): Promise<boolean>;
  get(sessionId: string): Promise<RecordingRow | null>;
  /** Creates or replaces the session's pending row. */
  savePending(row: Omit<RecordingRow, "status">): Promise<void>;
  markUploaded(sessionId: string): Promise<void>;
}

export type RecordingStorage = Pick<ResumeStorage, "presignPut" | "head" | "deleteObject">;

export interface RecordingHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: RecordingStore;
  storage: RecordingStorage;
  /** Runs once a recording is confirmed uploaded (e.g. the audio review). */
  onUploaded?: (done: { userId: string; sessionId: string }) => void;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "already_uploaded"
  | "upload_missing"
  | "upload_mismatch"
  | "storage_failed";

function fail(status: number, error: ErrorCode, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

export function recordingKey(userId: string, sessionId: string, contentType: string): string {
  return `recordings/${userId}/${sessionId}.${RECORDING_TYPES[contentType]}`;
}

export function validateRecordingRequest(
  value: unknown,
): { ok: true; contentType: string; size: number } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Send contentType and size." };
  }
  const { contentType, size } = value as Record<string, unknown>;
  if (typeof contentType !== "string" || !Object.hasOwn(RECORDING_TYPES, contentType)) {
    return { ok: false, message: "Only webm, mp4 or ogg audio is allowed." };
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_RECORDING_BYTES) {
    return { ok: false, message: "The recording must be between 1 byte and 25 MB." };
  }
  return { ok: true, contentType, size };
}

/** POST /api/sessions/:id/recording/upload-url */
export async function handleCreateRecordingUpload(
  request: Request,
  sessionId: string,
  deps: RecordingHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to save a recording.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Session not found.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const input = validateRecordingRequest(body.value);
  if (!input.ok) return fail(400, "invalid_request", input.message);

  try {
    if (!(await deps.store.ownsSession(userId, sessionId))) {
      return fail(404, "not_found", "Session not found.");
    }
    const existing = await deps.store.get(sessionId);
    if (existing?.status === "uploaded") {
      return fail(409, "already_uploaded", "This interview already has a recording.");
    }
    const key = recordingKey(userId, sessionId, input.contentType);
    await deps.store.savePending({
      session_id: sessionId,
      user_id: userId,
      s3_key: key,
      content_type: input.contentType,
      size_bytes: input.size,
    });
    const url = await deps.storage.presignPut(key, input.contentType, input.size, RECORDING_URL_TTL_SECONDS);
    return jsonResponse(201, {
      success: true,
      upload: {
        url,
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        expiresIn: RECORDING_URL_TTL_SECONDS,
      },
    });
  } catch {
    return fail(500, "storage_failed", "Could not store the recording.");
  }
}

/** POST /api/sessions/:id/recording/confirm */
export async function handleConfirmRecording(
  sessionId: string,
  deps: RecordingHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to save a recording.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Session not found.");

  try {
    const row = await deps.store.get(sessionId);
    // The row carries the owner, so a stranger gets the same 404 as no row.
    if (!row || row.user_id !== userId) return fail(404, "not_found", "Recording not found.");
    if (row.status === "uploaded") return jsonResponse(200, { success: true });

    const object = await deps.storage.head(row.s3_key);
    if (!object) return fail(409, "upload_missing", "The recording has not been uploaded yet.");
    if (object.size !== row.size_bytes || object.contentType !== row.content_type) {
      await deps.storage.deleteObject(row.s3_key);
      return fail(422, "upload_mismatch", "The uploaded recording does not match.");
    }
    await deps.store.markUploaded(sessionId);
    try {
      deps.onUploaded?.({ userId, sessionId });
    } catch {
      console.error("[recording] upload hook failed");
    }
    return jsonResponse(200, { success: true });
  } catch {
    return fail(500, "storage_failed", "Could not store the recording.");
  }
}
