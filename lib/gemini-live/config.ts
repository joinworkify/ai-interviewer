import { parseAppOrigin } from "./origin";

/**
 * Server-only Gemini Live configuration. `GEMINI_API_KEY` must never be
 * exposed to the browser; it is only used to mint ephemeral tokens.
 */

export interface GeminiLiveConfig {
  apiKey: string;
  model: string;
}

export type GeminiLiveConfigResult =
  | ({ ok: true } & GeminiLiveConfig)
  | { ok: false; missing: string[]; invalid: string[] };

const MODEL_ID_RE = /^[a-z0-9][a-z0-9.-]{2,79}$/;
/**
 * Live API audio models are named "...-live..." or "...native-audio...".
 * This rejects ordinary text models such as "gemini-2.5-flash", which do not
 * support the bidirectional audio Live API.
 */
const LIVE_MODEL_RE = /(^|-)live(-|$)|native-audio/;

export function readGeminiLiveConfig(
  env: Record<string, string | undefined>,
): GeminiLiveConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const apiKey = env.GEMINI_API_KEY?.trim() ?? "";
  const model = (env.GEMINI_LIVE_MODEL?.trim() ?? "").replace(/^models\//, "");

  if (!apiKey) missing.push("GEMINI_API_KEY");
  if (!model) {
    missing.push("GEMINI_LIVE_MODEL");
  } else if (!MODEL_ID_RE.test(model) || !LIVE_MODEL_RE.test(model)) {
    invalid.push(
      "GEMINI_LIVE_MODEL (must be a Live API native-audio model id, e.g. gemini-3.8-live — not a text model like gemini-2.5-flash)",
    );
  }

  // Optional public origin for the CSRF check (see lib/gemini-live/origin.ts).
  const appOrigin = env.GEMINI_LIVE_APP_ORIGIN?.trim();
  if (appOrigin && parseAppOrigin(appOrigin) === null) {
    invalid.push(
      "GEMINI_LIVE_APP_ORIGIN (optional; must be an origin like https://app.example.com — no path)",
    );
  }

  if (missing.length > 0 || invalid.length > 0) {
    return { ok: false, missing, invalid };
  }
  return { ok: true, apiKey, model };
}
