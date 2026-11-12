import { handleDeleteSession } from "@/lib/data-deletion/handlers";
import { runDeletionRoute } from "@/lib/data-deletion/route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleGetSession } from "@/lib/sessions/handlers";
import { runSessionRoute } from "@/lib/sessions/route-deps";

/** A session owned by the signed-in user, with its feedback if it exists. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return runSessionRoute((deps) => handleGetSession(id, deps));
}

/** Delete a session. Its feedback is deleted with it. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runDeletionRoute((deps) => handleDeleteSession(id, deps));
}
