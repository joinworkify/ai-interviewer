import { handleStartAttempt } from "@/lib/candidate/attempts";
import { runAttemptRoute } from "@/lib/candidate/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/**
 * Start an interview attempt for the signed-in candidate: creates the
 * interview (the role's questions) and its session, and returns the session id.
 */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runAttemptRoute((deps) => handleStartAttempt(request, deps));
}
