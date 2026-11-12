import { handleDeleteTranscript } from "@/lib/data-deletion/handlers";
import { runDeletionRoute } from "@/lib/data-deletion/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handlePutTranscript } from "@/lib/transcripts/handlers";
import { runTranscriptRoute } from "@/lib/transcripts/route-deps";

/** Store the transcript of one of the signed-in user's sessions, once. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runTranscriptRoute((deps) => handlePutTranscript(request, id, deps));
}

/** Delete a session's transcript and recording URL. The feedback is kept. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runDeletionRoute((deps) => handleDeleteTranscript(id, deps));
}
