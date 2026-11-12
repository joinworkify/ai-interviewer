/**
 * Same-origin (CSRF) check for mutating JSON routes. This is not identity:
 * routes still require a verified Supabase session. Provider-agnostic; shared
 * by /api/sessions/*, the deletion routes and (through a re-export) the Gemini
 * Live token route.
 *
 * Expected origin:
 *  1. The env var named by `originEnvKey` (server-only, default APP_ORIGIN),
 *     when set — e.g. the public https origin behind a reverse proxy. Invalid
 *     values fail closed.
 *  2. Otherwise: scheme from request.url + authority from the validated
 *     `Host` header. Next can report request.url as http://localhost:PORT
 *     while the browser actually uses http://127.0.0.1:PORT, and the Host
 *     header reflects what the browser connected to. If Host is absent, the
 *     request.url authority is used.
 * X-Forwarded-Host / X-Forwarded-Proto are never trusted here; use (1).
 */

export type OriginCheck = { ok: true } | { ok: false; misconfigured?: true };

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOST_RE = new RegExp(
  `^(?:(${LABEL}(?:\\.${LABEL})*)|\\[([0-9A-Fa-f:.]{2,45})\\])(?::(\\d{1,5}))?$`,
);

/** Strictly validates a Host header value; returns lowercase host[:port] or null. */
export function parseHostHeader(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 255) return null;
  const m = HOST_RE.exec(raw);
  if (!m) return null;
  const port = m[3];
  if (port !== undefined) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  }
  const host = m[1] !== undefined ? m[1].toLowerCase() : `[${m[2].toLowerCase()}]`;
  return port !== undefined ? `${host}:${port}` : host;
}

/**
 * Parses an http(s) origin ("scheme://host[:port]", optional trailing "/").
 * Rejects paths, query, fragment, credentials and opaque origins ("null").
 * Used for both the configured app origin and the Origin request header.
 */
export function parseAppOrigin(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.includes("?") || value.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  if (parseHostHeader(url.host) === null) return null;
  return url.origin;
}

function expectedOriginFromRequest(request: Request): string | null {
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return null;
  }
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return null;
  const hostHeader = request.headers.get("host");
  const host = hostHeader === null ? requestUrl.host : parseHostHeader(hostHeader);
  if (!host) return null;
  try {
    // URL normalizes case and default ports (http :80, https :443).
    return new URL(`${requestUrl.protocol}//${host}`).origin;
  } catch {
    return null;
  }
}

export function checkSameOrigin(
  request: Request,
  env: Record<string, string | undefined>,
  originEnvKey = "APP_ORIGIN",
): OriginCheck {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return { ok: false };

  const configured = env[originEnvKey]?.trim();
  let expected: string | null;
  if (configured) {
    expected = parseAppOrigin(configured);
    if (!expected) return { ok: false, misconfigured: true };
  } else {
    expected = expectedOriginFromRequest(request);
    if (!expected) return { ok: false };
  }

  const origin = parseAppOrigin(request.headers.get("origin"));
  return origin !== null && origin === expected ? { ok: true } : { ok: false };
}
