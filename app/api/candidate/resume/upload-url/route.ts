import { handleCreateUploadUrl } from "@/lib/candidate/resume";
import { runResumeRoute } from "@/lib/candidate/resume-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Start a resume upload: returns a short-lived presigned S3 PUT URL. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runResumeRoute((deps) => handleCreateUploadUrl(request, deps));
}
