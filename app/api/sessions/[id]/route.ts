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
