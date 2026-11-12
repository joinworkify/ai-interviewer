import { jsonResponse } from "@/lib/http/json";
import { checkSameOrigin } from "@/lib/http/origin";

/**
 * Same-origin (CSRF) guard for mutating routes. Call it first, before auth and
 * body parsing, and return its response when it is not null:
 *
 *   const blocked = guardSameOrigin(request, process.env);
 *   if (blocked) return blocked;
 *
 * Session cookies are sent on cross-site requests unless SameSite stops them,
 * so mutating routes also require a matching Origin. Not identity: the route
 * still verifies the user. The expected origin comes from APP_ORIGIN when set
 * (behind a proxy), otherwise from the Host header; see lib/http/origin.ts.
 */
export function guardSameOrigin(
  request: Request,
  env: Record<string, string | undefined>,
): Response | null {
  const check = checkSameOrigin(request, env);
  if (check.ok) return null;
  if (check.misconfigured) {
    console.error("[origin] APP_ORIGIN is set but is not a valid origin.");
    return jsonResponse(503, {
      success: false,
      error: "server_misconfigured",
      message: "Server origin is misconfigured.",
    });
  }
  return jsonResponse(403, {
    success: false,
    error: "forbidden_origin",
    message: "Cross-origin request blocked.",
  });
}
