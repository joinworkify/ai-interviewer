import { handleGetAttempt } from "@/lib/candidate/attempts";
import { runAttemptRoute } from "@/lib/candidate/route-deps";

/**
 * Where one of the signed-in candidate's attempts stands: processing,
 * submitted or incomplete. Read-only, so there is no origin check; it never
 * returns a transcript, feedback or score.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runAttemptRoute((deps) => handleGetAttempt(id, deps));
}
