/**
 * Downloads a call transcript from the URL Dograh put in its webhook.
 *
 * That URL arrives in a request body, so it is untrusted: a forged or tampered
 * value must not make this server fetch an arbitrary address (SSRF). Rules:
 *  - the URL's origin must equal the configured Dograh API origin;
 *  - Dograh answers with a 302 to a signed storage URL, so redirects are
 *    followed by hand, at most once, and only to the API origin or the
 *    configured storage origin;
 *  - a timeout and a byte cap apply to the whole download.
 *
 * The transcript URL carries a public access token. It is never logged and
 * never returned in an error.
 */

export const DEFAULT_TRANSCRIPT_TIMEOUT_MS = 10_000;
/** The stored transcript is capped far below this; the cap only bounds memory. */
export const DEFAULT_TRANSCRIPT_MAX_BYTES = 256 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 1;

export type TranscriptFetchFailure =
  | "invalid_url"
  | "foreign_origin"
  | "http_error"
  | "too_large"
  | "timeout"
  | "network";

export type TranscriptFetchResult =
  | { ok: true; text: string }
  | { ok: false; reason: TranscriptFetchFailure };

export interface TranscriptFetchOptions {
  apiOrigin: string;
  storageOrigin?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function fetchTranscriptText(
  rawUrl: string,
  options: TranscriptFetchOptions,
): Promise<TranscriptFetchResult> {
  if (rawUrl.length > MAX_URL_LENGTH) return { ok: false, reason: "invalid_url" };
  const first = parseUrl(rawUrl);
  if (!first) return { ok: false, reason: "invalid_url" };
  if (first.origin !== options.apiOrigin) return { ok: false, reason: "foreign_origin" };

  const allowed = new Set([options.apiOrigin]);
  if (options.storageOrigin) allowed.add(options.storageOrigin);
  const doFetch = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_TRANSCRIPT_MAX_BYTES;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TRANSCRIPT_TIMEOUT_MS,
  );
  try {
    let url = first;
    for (let hop = 0; ; hop++) {
      const response = await doFetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/plain, */*;q=0.1" },
      });

      if (response.status >= 300 && response.status < 400) {
        if (hop >= MAX_REDIRECTS) return { ok: false, reason: "http_error" };
        const location = response.headers.get("location");
        const next = location ? parseUrl(location, url.toString()) : null;
        if (!next) return { ok: false, reason: "invalid_url" };
        if (!allowed.has(next.origin)) return { ok: false, reason: "foreign_origin" };
        await response.body?.cancel().catch(() => undefined);
        url = next;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: "http_error" };
      }
      const text = await readCapped(response, maxBytes);
      return text === null ? { ok: false, reason: "too_large" } : { ok: true, text };
    }
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
