import { handleDograhWebhook } from "@/lib/dograh/webhook-handler";
import { runDograhWebhookRoute } from "@/lib/dograh/route-deps";

// The AI evaluation runs after the response (see route-deps.ts) and calls a
// model, so the function needs more than the platform default to finish it.
export const maxDuration = 60;

/**
 * Receives the end-of-call webhook from the Dograh agent and stores the
 * transcript on the interview session named by the signed session token.
 * Server to server: no browser session and no Origin check. The handler
 * authenticates the caller with DOGRAH_WEBHOOK_SECRET. See DOGRAH_SETUP.md.
 */
export async function POST(request: Request) {
  return runDograhWebhookRoute((deps) => handleDograhWebhook(request, deps));
}
