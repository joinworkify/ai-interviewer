import { handleConfirmUpload } from "@/lib/candidate/resume";
import { runResumeRoute } from "@/lib/candidate/resume-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Finish a resume upload once the file is in S3. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runResumeRoute((deps) => handleConfirmUpload(request, deps));
}
