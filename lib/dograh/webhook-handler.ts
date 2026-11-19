import { createHash, timingSafeEqual } from "node:crypto";

import { jsonResponse, readJsonBody } from "@/lib/http/json";
import type { TranscriptStore } from "@/lib/transcripts/store";
import { validateTranscriptBody, type AdapterRegistry } from "@/lib/transcripts/validation";

import { readDograhConfig } from "./config";
import { verifySessionToken } from "./session-token";
import { fetchTranscriptText } from "./transcript-fetch";

/**
 * `POST /api/dograh/webhook`: Dograh calls this when a call ends.
 * Framework-agnostic (Request -> Response) with injected dependencies.
 *
 * Dograh does not sign webhooks, so the request carries a static
 * `Authorization: Bearer <DOGRAH_WEBHOOK_SECRET>` (configured on the webhook
 * node). That only proves the caller knows the secret. Which user and session
 * the transcript belongs to comes from the signed session token inside the
 * body, never from a plain field.
 *
 * Check order: webhook secret present -> Bearer -> config -> body -> session
 * token -> transcript download -> adapter and limits -> set-once write.
 * Unauthenticated callers learn nothing about the configuration. Transcript
 * text, the transcript URL and tokens are never logged or returned.
 *
 * Dograh may deliver the same webhook more than once. A repeat for a session
 * that already has a transcript answers 200 with `duplicate: true`.
 */

export const MAX_WEBHOOK_BODY_BYTES = 8 * 1024;
const MAX_DISPOSITION_CHARS = 64;
const MAX_DURATION_SECONDS = 3600;

export interface DograhWebhookDeps {
  env: Record<string, string | undefined>;
  store: TranscriptStore;
  adapters: AdapterRegistry;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /**
   * Called once, after a transcript was stored for the first time (not for a
   * repeat delivery). Used to start the AI evaluation without delaying the
   * answer to Dograh. A throw here never changes the webhook's response.
   */
  onStored?: (info: { userId: string; sessionId: string }) => void;
}

function fail(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse(status, { success: false, error, message, ...extra });
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Compares digests, so neither the value nor its length leaks through timing. */
function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer (\S{1,512})$/.exec(header ?? "");
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]), sha256(secret));
}

const BODY_KEYS = [
  "workflow_run_id",
  "call_time",
  "duration_seconds",
  "call_disposition",
  "session_token",
  "transcript_url",
];

interface WebhookFields {
  durationSeconds: number;
  disposition: string;
  sessionToken: string;
  transcriptUrl: string | null;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && /^\s*(none|null)?\s*$/i.test(v));
}

/**
 * Strict about shape and unknown keys, lenient about how Dograh renders the
 * template values: numbers can arrive as strings, and missing values as "".
 */
function parseFields(value: unknown): { ok: true; data: WebhookFields } | { ok: false; errors: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["Body must be a JSON object."] };
  }
  const record = value as Record<string, unknown>;
  const errors = Object.keys(record)
    .filter((k) => !BODY_KEYS.includes(k))
    .map((k) => `Unknown field "${k.slice(0, 40)}".`);

  const runId = record.workflow_run_id;
  const runIdOk =
    (typeof runId === "number" && Number.isSafeInteger(runId) && runId > 0) ||
    (typeof runId === "string" && /^[1-9][0-9]{0,15}$/.test(runId));
  if (!runIdOk) errors.push("workflow_run_id must be a positive integer.");

  let durationSeconds = 0;
  const rawDuration = record.duration_seconds;
  if (!isEmpty(rawDuration)) {
    const n = typeof rawDuration === "number" ? rawDuration : Number(rawDuration);
    if (typeof rawDuration !== "number" && typeof rawDuration !== "string") {
      errors.push("duration_seconds must be a number.");
    } else if (!Number.isFinite(n) || n < 0) {
      errors.push("duration_seconds must be a non-negative number.");
    } else {
      durationSeconds = Math.min(MAX_DURATION_SECONDS, Math.round(n));
    }
  }

  let disposition = "";
  if (!isEmpty(record.call_disposition)) {
    if (typeof record.call_disposition !== "string") {
      errors.push("call_disposition must be a string.");
    } else {
      disposition = record.call_disposition
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, MAX_DISPOSITION_CHARS);
    }
  }

  if (typeof record.session_token !== "string" || record.session_token.length === 0) {
    errors.push("session_token is required.");
  }

  let transcriptUrl: string | null = null;
  if (!isEmpty(record.transcript_url)) {
    if (typeof record.transcript_url !== "string") errors.push("transcript_url must be a string.");
    else transcriptUrl = record.transcript_url.trim();
  }

  if (record.call_time !== undefined && typeof record.call_time !== "string") {
    errors.push("call_time must be a string.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    data: {
      durationSeconds,
      disposition,
      sessionToken: record.session_token as string,
      transcriptUrl,
    },
  };
}

export async function handleDograhWebhook(
  request: Request,
  deps: DograhWebhookDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;

  // 1. The secret must exist before anything can be authenticated. No names
  //    here: the caller is not authenticated yet.
  const secret = deps.env.DOGRAH_WEBHOOK_SECRET ?? "";
  if (secret.length === 0) {
    console.error("[dograh-webhook] DOGRAH_WEBHOOK_SECRET is not set");
    return fail(503, "server_misconfigured", "Webhook is not configured.");
  }

  // 2. Bearer secret, before the body is read.
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return fail(401, "unauthorized", "Invalid credentials.");
  }

  // 3. Authenticated now, so naming the missing variables is fine.
  const config = readDograhConfig(deps.env);
  if (!config.ok) {
    return fail(503, "dograh_not_configured", "Dograh is not configured on the server.", {
      missing: config.missing,
      invalid: config.invalid,
    });
  }

  // 4. Body.
  const body = await readJsonBody(request, MAX_WEBHOOK_BODY_BYTES);
  if (!body.ok) return fail(body.status, body.error, body.message);
  const fields = parseFields(body.value);
  if (!fields.ok) {
    return fail(400, "invalid_request", "Invalid webhook body.", { details: fields.errors });
  }

  // 5. Who and which session: only from the signed token.
  const token = verifySessionToken(fields.data.sessionToken, config.sessionSecret, now());
  if (!token.ok) {
    return fail(401, "invalid_session_token", "The session token is not valid.");
  }

  // 6. The transcript file. No URL means the call produced no transcript.
  let transcriptText = "";
  if (fields.data.transcriptUrl) {
    const fetched = await fetchTranscriptText(fields.data.transcriptUrl, {
      apiOrigin: config.apiOrigin,
      storageOrigin: config.storageOrigin,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });
    if (!fetched.ok) {
      console.error(`[dograh-webhook] transcript download failed reason=${fetched.reason}`);
      if (fetched.reason === "invalid_url" || fetched.reason === "foreign_origin") {
        return fail(422, "invalid_transcript_url", "The transcript URL is not accepted.");
      }
      return fail(502, "transcript_unavailable", "Could not download the transcript.");
    }
    transcriptText = fetched.text;
  }

  // 7. Dograh's format -> canonical turns, then the shared size limits.
  const parsed = validateTranscriptBody(
    {
      source: "dograh_webhook",
      payload: {
        transcript: transcriptText,
        durationSeconds: fields.data.durationSeconds,
        disposition: fields.data.disposition,
      },
    },
    deps.adapters,
  );
  if (!parsed.ok) {
    return fail(422, "invalid_transcript", "The transcript could not be used.", {
      details: parsed.errors,
    });
  }

  // 8. Set-once write for the user and session named in the token.
  try {
    const outcome = await deps.store.storeOnce({
      sessionId: token.payload.sid,
      userId: token.payload.sub,
      transcript: parsed.data.transcript,
      metadata: parsed.data.metadata,
      endedAtIso: new Date(now()).toISOString(),
    });
    if (outcome.kind === "not_found") return fail(404, "not_found", "Session not found.");
    if (outcome.kind === "already_stored") {
      return jsonResponse(200, { success: true, duplicate: true });
    }
    try {
      deps.onStored?.({ userId: token.payload.sub, sessionId: token.payload.sid });
    } catch {
      console.error("[dograh-webhook] post-store hook failed");
    }
    return jsonResponse(200, {
      success: true,
      session: { id: token.payload.sid, status: outcome.status },
      transcript: {
        source: parsed.data.metadata.source,
        entries: parsed.data.transcript.length,
      },
    });
  } catch {
    return fail(500, "storage_failed", "Could not save the transcript.");
  }
}
