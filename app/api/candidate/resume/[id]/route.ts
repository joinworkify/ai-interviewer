import { handleDeleteResume, handleSelectResume } from "@/lib/candidate/resume";
import { runResumeRoute } from "@/lib/candidate/resume-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Use this saved resume for applications. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runResumeRoute((deps) => handleSelectResume(id, deps));
}

/** Delete one of the signed-in candidate's resumes (file and record). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runResumeRoute((deps) => handleDeleteResume(id, deps));
}
