import { handleDeleteTranscript } from "@/lib/data-deletion/handlers";
import { runDeletionRoute } from "@/lib/data-deletion/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

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
