/**
 * Paths a signed-out visitor may reach without being redirected to the login
 * page. Everything else needs a Supabase session (see lib/supabase/proxy.ts).
 *
 * A path is listed here only when it either is part of the sign-in flow or
 * authenticates itself and answers a structured JSON 401 / 403:
 *
 *   /api/vapi/generate-interview    Vapi server call, signed capability token
 *   /api/dograh/webhook             Dograh server call, Bearer secret + signed token
 *   /api/dograh/session             checks the signed-in user itself (JSON 401)
 *   /api/gemini-live/token          same
 *   /api/account/data               same
 *   /api/sessions[/<id>[/transcript|/feedback]]   same
 *   /api/candidate/attempts[/<id>]  same
 *   /api/candidate/resume[/upload-url|/confirm]   same
 *   /api/candidate/profile          same
 *   /api/admin/sessions/<id>/review checks for a signed-in admin (JSON 401 / 403)
 *
 * Exact paths and anchored patterns only: no `startsWith` prefixes, so a new
 * route such as /api/sessionsX or /api/dograh/other stays behind the login
 * until it is added here on purpose and checks its caller itself.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const EXACT_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/api/vapi/generate-interview",
  "/api/gemini-live/token",
  "/api/account/data",
  "/api/dograh/session",
  "/api/dograh/webhook",
  "/api/candidate/attempts",
  "/api/candidate/resume",
  "/api/candidate/resume/upload-url",
  "/api/candidate/resume/confirm",
  "/api/candidate/profile",
  "/api/sessions",
]);

const PATTERNS: readonly RegExp[] = [
  // The sign-in flow: /auth/login, /auth/sign-up, /auth/confirm, ...
  /^\/auth(\/|$)/,
  new RegExp(`^/api/candidate/attempts/${UUID}$`, "i"),
  new RegExp(`^/api/sessions/${UUID}(/(transcript|feedback))?$`, "i"),
  // Checks the caller is a signed-in admin itself (JSON 401 / 403).
  new RegExp(`^/api/admin/sessions/${UUID}/review$`, "i"),
];

export function isPublicPath(pathname: string): boolean {
  return EXACT_PATHS.has(pathname) || PATTERNS.some((p) => p.test(pathname));
}
