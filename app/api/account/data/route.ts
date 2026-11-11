import { handleDeleteAccount } from "@/lib/data-deletion/handlers";
import { runDeletionRoute } from "@/lib/data-deletion/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/**
 * Delete the signed-in user's account and everything held for it. Body must be
 * {"confirm":"delete-my-data"}.
 */
export async function DELETE(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runDeletionRoute((deps) => handleDeleteAccount(request, deps));
}
