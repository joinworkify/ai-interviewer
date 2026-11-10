import { handleStartSession } from "@/lib/sessions/handlers";
import { runSessionRoute } from "@/lib/sessions/route-deps";

/** Start an interview session for one of the signed-in user's interviews. */
export async function POST(request: Request) {
  return runSessionRoute((deps) => handleStartSession(request, deps));
}
