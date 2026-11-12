import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleSubmitFeedback } from "@/lib/sessions/handlers";
import { runSessionRoute } from "@/lib/sessions/route-deps";

// The LLM call can take up to LLM_TIMEOUT_MS (plus one retry on fast failures).
export const maxDuration = 60;

/** Evaluate the submitted answers and save the AI feedback for the session. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runSessionRoute((deps) => handleSubmitFeedback(request, id, deps));
}
