import { handleAssign } from "@/lib/admin/workflow";
import { runWorkflowRoute } from "@/lib/admin/workflow-server";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Admins only: assign an interview to a reviewer (or clear it). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runWorkflowRoute((deps) => handleAssign(request, id, deps));
}
