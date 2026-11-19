import { handleNote } from "@/lib/admin/workflow";
import { runWorkflowRoute } from "@/lib/admin/workflow-server";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Admins only: add an internal note to an interview. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runWorkflowRoute((deps) => handleNote(request, id, deps));
}

/** Admins only: delete your own note. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runWorkflowRoute((deps) => handleNote(request, id, deps));
}
