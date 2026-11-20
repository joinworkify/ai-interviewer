import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleCreateRecordingUpload } from "@/lib/recording/recording";
import { runRecordingRoute } from "@/lib/recording/route-deps";

/** Start a recording upload: returns a short-lived presigned S3 PUT URL. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runRecordingRoute((deps) => handleCreateRecordingUpload(request, id, deps));
}
