import { jsonResponse, readJsonBody } from "@/lib/http/json";
import { isUuid } from "@/lib/sessions/validation";

/**
 * POST /api/sessions/:id/identity { image: <base64 JPEG> }: one camera
 * snapshot taken at setup, kept for a reviewer to look at. Small enough to
 * send through the server (about 480 px wide), so it is checked here before
 * it is written to private storage: it must really be a JPEG and under the
 * size cap. Nothing compares it with anything automatically; it is a person
 * reviewing a photo. Optional for the candidate: no photo is simply flagged.
 */

export const MAX_IDENTITY_BYTES = 300 * 1024;
const MAX_BODY_BYTES = Math.ceil((MAX_IDENTITY_BYTES * 4) / 3) + 256;

export interface IdentityStore {
  ownsSession(userId: string, sessionId: string): Promise<boolean>;
  save(row: { sessionId: string; userId: string; key: string; size: number }): Promise<void>;
}

export interface IdentityStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface IdentityHandlerDeps {
  getUserId: () => Promise<string | null>;
  store: IdentityStore;
  storage: IdentityStorage;
}

export const identityKey = (userId: string, sessionId: string) => `identity/${userId}/${sessionId}.jpg`;

function fail(status: number, error: string, message: string): Response {
  return jsonResponse(status, { success: false, error, message });
}

/** Decodes standard base64 (with or without a data-URL prefix); null when malformed. */
export function decodeJpeg(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const raw = value.replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) return null;
  const bytes = Uint8Array.from(Buffer.from(raw, "base64"));
  if (bytes.length < 4 || bytes.length > MAX_IDENTITY_BYTES) return null;
  // JPEG start-of-image marker.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

export async function handleSaveIdentityPhoto(
  request: Request,
  sessionId: string,
  deps: IdentityHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in required.");
  if (!isUuid(sessionId)) return fail(404, "not_found", "Session not found.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const bytes = decodeJpeg((body.value as { image?: unknown } | null)?.image);
  if (!bytes) return fail(400, "invalid_request", "Send a JPEG photo under 300 KB.");

  try {
    if (!(await deps.store.ownsSession(userId, sessionId))) return fail(404, "not_found", "Session not found.");
    const key = identityKey(userId, sessionId);
    await deps.storage.put(key, bytes, "image/jpeg");
    await deps.store.save({ sessionId, userId, key, size: bytes.length });
    return jsonResponse(200, { success: true });
  } catch {
    return fail(500, "storage_failed", "Could not save the photo.");
  }
}
