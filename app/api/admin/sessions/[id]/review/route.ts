import { handleSetReviewStatus } from "@/lib/admin/review";
import { runReviewRoute } from "@/lib/admin/server";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Admins only: set the review status of one interview attempt. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runReviewRoute((deps) => handleSetReviewStatus(request, id, deps));
}
