import { handleBulkReview } from "@/lib/admin/workflow";
import { runReviewRoute } from "@/lib/admin/server";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Admins only: set the review status of several interviews at once. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runReviewRoute((deps) => handleBulkReview(request, deps));
}
