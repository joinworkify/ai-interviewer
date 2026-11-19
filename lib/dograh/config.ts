import { MIN_SIGNING_SECRET_LENGTH } from "@/lib/interviews/capability";

/**
 * Dograh configuration. Dograh is a separate self-hosted service that runs the
 * voice interview in the browser; see DOGRAH_SETUP.md.
 *
 * Server-only values (never exposed to the browser):
 *   DOGRAH_API_URL                  origin of the Dograh API, used to download transcripts
 *   DOGRAH_STORAGE_URL              optional origin of Dograh's file storage (MinIO / S3);
 *                                   a transcript download redirects there
 *   DOGRAH_WEBHOOK_SECRET           Bearer token the Dograh webhook node sends to us
 *   DOGRAH_SESSION_SIGNING_SECRET   signs the per-interview session token
 * Browser-visible (public by design, restricted to allowed domains in Dograh):
 *   NEXT_PUBLIC_DOGRAH_WIDGET_SRC   the widget script URL copied from Dograh's embed snippet
 *
 * Errors name the variables, never their values.
 */

export interface DograhConfig {
  /** Origin only, e.g. http://localhost:8000. */
  apiOrigin: string;
  /** Origin only, or null when a transcript download must stay on the API origin. */
  storageOrigin: string | null;
  webhookSecret: string;
  sessionSecret: string;
}

export type DograhConfigResult =
  | ({ ok: true } & DograhConfig)
  | { ok: false; missing: string[]; invalid: string[] };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Parses an http(s) origin. Plain http is only accepted for loopback hosts so
 * a production install cannot send secrets or transcripts in the clear.
 */
export function parseDograhOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

export function readDograhConfig(
  env: Record<string, string | undefined>,
): DograhConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];

  const apiRaw = env.DOGRAH_API_URL?.trim() ?? "";
  let apiOrigin = "";
  if (!apiRaw) missing.push("DOGRAH_API_URL");
  else {
    const parsed = parseDograhOrigin(apiRaw);
    if (parsed) apiOrigin = parsed;
    else invalid.push("DOGRAH_API_URL (an https origin, or http://localhost:<port> for local use)");
  }

  let storageOrigin: string | null = null;
  const storageRaw = env.DOGRAH_STORAGE_URL?.trim();
  if (storageRaw) {
    storageOrigin = parseDograhOrigin(storageRaw);
    if (!storageOrigin) {
      invalid.push("DOGRAH_STORAGE_URL (optional; an https origin, or http://localhost:<port> for local use)");
    }
  }

  const webhookSecret = env.DOGRAH_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) missing.push("DOGRAH_WEBHOOK_SECRET");
  else if (webhookSecret.length < MIN_SIGNING_SECRET_LENGTH) {
    invalid.push(`DOGRAH_WEBHOOK_SECRET (at least ${MIN_SIGNING_SECRET_LENGTH} characters)`);
  }

  const sessionSecret = env.DOGRAH_SESSION_SIGNING_SECRET ?? "";
  if (!sessionSecret) missing.push("DOGRAH_SESSION_SIGNING_SECRET");
  else if (sessionSecret.length < MIN_SIGNING_SECRET_LENGTH) {
    invalid.push(`DOGRAH_SESSION_SIGNING_SECRET (at least ${MIN_SIGNING_SECRET_LENGTH} characters)`);
  } else if (sessionSecret === webhookSecret) {
    invalid.push("DOGRAH_SESSION_SIGNING_SECRET (must differ from DOGRAH_WEBHOOK_SECRET)");
  }

  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return { ok: true, apiOrigin, storageOrigin, webhookSecret, sessionSecret };
}

export type DograhWidgetConfig =
  | { ok: true; src: string }
  | { ok: false; missing: string[]; invalid: string[] };

/** The one public value: where the browser loads the Dograh widget script from. */
export function readDograhWidgetConfig(
  env: Record<string, string | undefined>,
): DograhWidgetConfig {
  const raw = env.NEXT_PUBLIC_DOGRAH_WIDGET_SRC?.trim() ?? "";
  if (!raw) return { ok: false, missing: ["NEXT_PUBLIC_DOGRAH_WIDGET_SRC"], invalid: [] };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, missing: [], invalid: ["NEXT_PUBLIC_DOGRAH_WIDGET_SRC (a full URL)"] };
  }
  if (!parseDograhOrigin(url.origin) || url.username || url.password) {
    return {
      ok: false,
      missing: [],
      invalid: [
        "NEXT_PUBLIC_DOGRAH_WIDGET_SRC (an https URL, or http://localhost:<port> for local use)",
      ],
    };
  }
  return { ok: true, src: url.toString() };
}
