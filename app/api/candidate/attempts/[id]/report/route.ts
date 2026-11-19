import { handleReportProblem } from "@/lib/candidate/problem-reports";
import { runAttemptRoute } from "@/lib/candidate/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** The signed-in candidate reports a problem with one of their interviews. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runAttemptRoute((deps) => handleReportProblem(request, id, deps));
}
