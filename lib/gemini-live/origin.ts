import {
  checkSameOrigin as checkSameOriginFor,
  type OriginCheck,
} from "@/lib/http/origin";

/**
 * The same-origin check now lives in lib/http/origin.ts so non-Gemini routes
 * can use it. Gemini code keeps importing from here; the only Gemini-specific
 * part is the env var that overrides the expected origin.
 */
export { parseAppOrigin, parseHostHeader, type OriginCheck } from "@/lib/http/origin";

/** Same check, configured by GEMINI_LIVE_APP_ORIGIN (see GEMINI_LIVE_SETUP.md). */
export function checkSameOrigin(
  request: Request,
  env: Record<string, string | undefined>,
): OriginCheck {
  return checkSameOriginFor(request, env, "GEMINI_LIVE_APP_ORIGIN");
}
