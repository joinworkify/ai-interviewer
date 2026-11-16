/**
 * Validates a post-login `next` redirect target taken from a query string.
 *
 * Only a path on this site is allowed ("/candidate/roles?x=1"). Anything that
 * could leave the site is replaced by the fallback: absolute URLs
 * ("https://evil.example"), protocol-relative URLs ("//evil.example"),
 * backslash tricks ("/\evil.example"), other schemes ("javascript:...") and
 * control characters (a tab or newline is dropped by URL parsing, which would
 * turn "/\t/evil.example" into "//evil.example").
 *
 * Two entry points:
 *  - `safeNext(value)`: falls back to DEFAULT_NEXT. Used by the login form, the
 *    OAuth callback and the social sign-in buttons.
 *  - `safeNextPath(value, fallback)`: the same check with a caller-chosen
 *    fallback. Used by /auth/confirm.
 */

export const DEFAULT_NEXT = "/candidate/roles";

const MAX_LENGTH = 512;
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;
// Any origin works as a probe; only whether the result stays on it matters.
const PROBE_ORIGIN = "http://next.invalid";

export function safeNextPath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (CONTROL_OR_BACKSLASH.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments are resolved by the URL parser, so "/..//evil.example"
  // becomes "//evil.example", which a redirect would read as off-site. Check
  // the normalized result, not just the input.
  if (path.startsWith("//")) return fallback;
  return path;
}

/** Same-origin path from `value`, or DEFAULT_NEXT. */
export function safeNext(value: string | null | undefined): string {
  return safeNextPath(value, DEFAULT_NEXT);
}
