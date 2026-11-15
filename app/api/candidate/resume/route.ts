import { handleGetResume } from "@/lib/candidate/resume";
import { runResumeRoute } from "@/lib/candidate/resume-route-deps";

/** The signed-in candidate's latest resume and a short-lived download URL. */
export async function GET() {
  return runResumeRoute((deps) => handleGetResume(deps));
}
