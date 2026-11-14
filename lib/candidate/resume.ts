import { randomUUID } from "node:crypto";

import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

/**
 * Resume upload for the signed-in candidate. The file goes straight from the
 * browser to S3 through a short-lived presigned URL (it never passes through
 * this server, so Vercel's request size limit does not apply):
 *
 *   1. POST /api/candidate/resume/upload-url { fileName, contentType, size }
 *      -> records a 'pending' row, returns a presigned PUT URL.
 *   2. The browser PUTs the file to that URL with the given Content-Type.
 *   3. POST /api/candidate/resume/confirm { resumeId }
 *      -> checks the object in S3 matches, marks the row 'uploaded'.
 *   4. GET /api/candidate/resume -> the latest uploaded resume and a
 *      short-lived download URL.
 *
 * Framework-agnostic (Request -> Response) with injected dependencies, like
 * lib/candidate/attempts.ts. The user id comes only from verified Supabase
 * claims, never from the body.
 */

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_URL_TTL_SECONDS = 300;
const MAX_BODY_BYTES = 1024;

/** Allowed types and the file extension each one is stored under. */
export const RESUME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export interface ResumeRow {
  id: string;
  user_id: string;
  s3_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  status: string;
  created_at: string;
  uploaded_at: string | null;
}

export interface ResumeStore {
  createPending(row: {
    userId: string;
    key: string;
    fileName: string;
    contentType: string;
    size: number;
  }): Promise<{ id: string }>;
  /** The user's own row, or null. */
  get(userId: string, id: string): Promise<ResumeRow | null>;
  markUploaded(userId: string, id: string): Promise<ResumeRow>;
  /** The user's most recently uploaded resume, or null. */
  latestUploaded(userId: string): Promise<ResumeRow | null>;
}

export interface ResumeStorage {
  presignPut(key: string, contentType: string, size: number, ttlSeconds: number): Promise<string>;
  presignGet(key: string, fileName: string, ttlSeconds: number): Promise<string>;
  /** Size and type of a stored object, or null when it does not exist. */
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  deleteObject(key: string): Promise<void>;
}

export interface ResumeHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: ResumeStore;
  storage: ResumeStorage;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "upload_missing"
  | "upload_mismatch"
  | "storage_failed";

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

const unauthorized = () => fail(401, "unauthorized", "Sign in to upload a resume.");
const storageFailed = () => fail(500, "storage_failed", "Could not store the resume.");

export function resumeKey(userId: string, contentType: string): string {
  return `resumes/${userId}/${randomUUID()}.${RESUME_TYPES[contentType]}`;
}

/** Keeps only the base name and drops control characters. */
export function cleanFileName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

export function validateUploadRequest(
  value: unknown,
): { ok: true; fileName: string; contentType: string; size: number } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Send fileName, contentType and size." };
  }
  const { fileName, contentType, size } = value as Record<string, unknown>;
  const name = typeof fileName === "string" ? cleanFileName(fileName) : "";
  if (name.length < 1 || name.length > 255) {
    return { ok: false, message: "fileName must be 1 to 255 characters." };
  }
  if (typeof contentType !== "string" || !(contentType in RESUME_TYPES)) {
    return { ok: false, message: "Only PDF or Word (.docx) files are allowed." };
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_RESUME_BYTES) {
    return { ok: false, message: "The file must be between 1 byte and 5 MB." };
  }
  return { ok: true, fileName: name, contentType, size };
}

function publicResume(row: ResumeRow) {
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    size: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}

/** POST /api/candidate/resume/upload-url */
export async function handleCreateUploadUrl(
  request: Request,
  deps: ResumeHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const input = validateUploadRequest(body.value);
  if (!input.ok) return fail(400, "invalid_request", input.message);

  const key = resumeKey(userId, input.contentType);
  try {
    const { id } = await deps.store.createPending({
      userId,
      key,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
    });
    const uploadUrl = await deps.storage.presignPut(
      key,
      input.contentType,
      input.size,
      RESUME_URL_TTL_SECONDS,
    );
    return jsonResponse(201, {
      success: true,
      resumeId: id,
      upload: {
        url: uploadUrl,
        method: "PUT",
        headers: { "Content-Type": input.contentType },
        expiresIn: RESUME_URL_TTL_SECONDS,
      },
    });
  } catch {
    return storageFailed();
  }
}

/** POST /api/candidate/resume/confirm */
export async function handleConfirmUpload(
  request: Request,
  deps: ResumeHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const resumeId = (body.value as Record<string, unknown> | null)?.resumeId;
  if (!isUuid(resumeId)) return fail(400, "invalid_request", "Send the resumeId from the upload step.");

  try {
    const row = await deps.store.get(userId, resumeId);
    if (!row) return fail(404, "not_found", "Resume not found.");
    if (row.status === "uploaded") {
      return jsonResponse(200, { success: true, resume: publicResume(row) });
    }

    const object = await deps.storage.head(row.s3_key);
    if (!object) {
      return fail(409, "upload_missing", "The file has not been uploaded yet.");
    }
    if (object.size !== row.size_bytes || object.contentType !== row.content_type) {
      await deps.storage.deleteObject(row.s3_key);
      return fail(422, "upload_mismatch", "The uploaded file does not match. Please upload it again.");
    }

    const uploaded = await deps.store.markUploaded(userId, resumeId);
    return jsonResponse(200, { success: true, resume: publicResume(uploaded) });
  } catch {
    return storageFailed();
  }
}

/**
 * GET /api/candidate/resume: the caller's own latest resume.
 * TODO(team): reviewer access to other candidates' resumes needs an admin or
 * reviewer role, which does not exist yet.
 */
export async function handleGetResume(deps: ResumeHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();

  try {
    const row = await deps.store.latestUploaded(userId);
    if (!row) return fail(404, "not_found", "No resume uploaded yet.");
    const downloadUrl = await deps.storage.presignGet(
      row.s3_key,
      row.file_name,
      RESUME_URL_TTL_SECONDS,
    );
    return jsonResponse(200, {
      success: true,
      resume: publicResume(row),
      download: { url: downloadUrl, expiresIn: RESUME_URL_TTL_SECONDS },
    });
  } catch {
    return storageFailed();
  }
}
