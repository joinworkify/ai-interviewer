import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleSaveIdentityPhoto } from "@/lib/integrity/identity";
import { runIdentityRoute } from "@/lib/integrity/identity-route-deps";

/** Save the candidate's setup snapshot for the reviewer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runIdentityRoute((deps) => handleSaveIdentityPhoto(request, id, deps));
}
