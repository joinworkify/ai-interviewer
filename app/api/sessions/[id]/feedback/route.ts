import { handleSubmitFeedback } from "@/lib/sessions/handlers";
import { runSessionRoute } from "@/lib/sessions/route-deps";

// The LLM call can take up to LLM_TIMEOUT_MS (plus one retry on fast failures).
export const maxDuration = 60;

/** Evaluate the submitted answers and save the AI feedback for the session. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runSessionRoute((deps) => handleSubmitFeedback(request, id, deps));
}
