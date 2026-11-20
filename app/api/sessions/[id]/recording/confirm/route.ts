import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleConfirmRecording } from "@/lib/recording/recording";
import { runRecordingRoute } from "@/lib/recording/route-deps";

/** Check the audio landed in storage and mark the recording uploaded. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runRecordingRoute((deps) => handleConfirmRecording(id, deps));
}
