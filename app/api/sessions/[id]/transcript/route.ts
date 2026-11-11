import { handlePutTranscript } from "@/lib/transcripts/handlers";
import { runTranscriptRoute } from "@/lib/transcripts/route-deps";

/** Store the transcript of one of the signed-in user's sessions, once. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runTranscriptRoute((deps) => handlePutTranscript(request, id, deps));
}
