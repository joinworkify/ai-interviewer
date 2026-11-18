import { jsonResponse, readJsonBody } from "@/lib/http/json";

/**
 * Contact details the signed-in candidate saves on their profile:
 *
 *   POST /api/candidate/profile { name?, phone?, linkedinUrl?, portfolioUrl? }
 *
 * Only the fields present in the body change; null or "" clears an optional
 * one. Framework-agnostic (Request -> Response) with injected dependencies,
 * like lib/candidate/resume.ts. The user id comes only from verified Supabase
 * claims, never from the body. Browsers could write `profiles` themselves (RLS
 * allows updating one's own row), so the same rules are also CHECK constraints
 * in the database.
 */

const MAX_BODY_BYTES = 4096;
export const MAX_NAME_LENGTH = 100;
export const MAX_URL_LENGTH = 2048;

export interface ProfileFields {
  name?: string;
  phone?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
}

export interface ProfileStore {
  /** Updates the user's own row; false when there is no such profile. */
  update(userId: string, fields: ProfileFields): Promise<boolean>;
}

export interface ProfileHandlerDeps {
  /** Verified Supabase user id, or null when not signed in. */
  getUserId: () => Promise<string | null>;
  store: ProfileStore;
}

type ErrorCode =
  | "unauthorized"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "not_found"
  | "storage_failed";

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

function parseName(value: unknown): Parsed<string> {
  const name = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
    return {
      ok: false,
      message: `name must be 1 to ${MAX_NAME_LENGTH} characters.`,
    };
  }
  return { ok: true, value: name };
}

/** Digits with an optional leading +, 7 to 15 of them (E.164 allows 15). Spaces, dashes and brackets are dropped. */
function parsePhone(value: unknown): Parsed<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  const cleaned = typeof value === "string" ? value.trim().replace(/[\s\-()]/g, "") : "";
  if (!/^\+?\d{7,15}$/.test(cleaned)) {
    return {
      ok: false,
      message: "phone must be 7 to 15 digits, with an optional leading +.",
    };
  }
  return { ok: true, value: cleaned };
}

/** A full http(s) link. Other schemes (javascript:, data:) are refused because reviewers will see these as links. */
function parseUrl(field: string, value: unknown): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  // A non-string must not read as "" and silently clear the field.
  if (typeof value !== "string")
    return { ok: false, message: `${field} must be a full http(s) link.` };
  const text = value.trim();
  if (text === "") return { ok: true, value: null };
  try {
    const url = new URL(text);
    if ((url.protocol === "https:" || url.protocol === "http:") && text.length <= MAX_URL_LENGTH) {
      return { ok: true, value: text };
    }
  } catch {
    // fall through
  }
  return { ok: false, message: `${field} must be a full http(s) link.` };
}

export function validateProfileRequest(
  value: unknown,
): { ok: true; fields: ProfileFields } | { ok: false; message: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Send the profile fields to save." };
  }
  const body = value as Record<string, unknown>;
  const fields: ProfileFields = {};

  const parts: [keyof ProfileFields, Parsed<string | null>][] = [];
  if ("name" in body) parts.push(["name", parseName(body.name)]);
  if ("phone" in body) parts.push(["phone", parsePhone(body.phone)]);
  if ("linkedinUrl" in body) parts.push(["linkedinUrl", parseUrl("linkedinUrl", body.linkedinUrl)]);
  if ("portfolioUrl" in body)
    parts.push(["portfolioUrl", parseUrl("portfolioUrl", body.portfolioUrl)]);

  if (parts.length === 0)
    return {
      ok: false,
      message: "Send at least one of name, phone, linkedinUrl or portfolioUrl.",
    };
  for (const [key, parsed] of parts) {
    if (!parsed.ok) return { ok: false, message: parsed.message };
    (fields as Record<string, unknown>)[key] = parsed.value;
  }
  return { ok: true, fields };
}

/** POST /api/candidate/profile */
export async function handleSaveProfile(
  request: Request,
  deps: ProfileHandlerDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return fail(401, "unauthorized", "Sign in to save your profile.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const input = validateProfileRequest(body.value);
  if (!input.ok) return fail(400, "invalid_request", input.message);

  try {
    const found = await deps.store.update(userId, input.fields);
    if (!found) return fail(404, "not_found", "Profile not found.");
    return jsonResponse(200, { success: true, profile: input.fields });
  } catch {
    return fail(500, "storage_failed", "Could not save your profile.");
  }
}
