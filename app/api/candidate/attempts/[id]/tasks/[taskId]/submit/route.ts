import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleSubmitTask } from "@/lib/tasks/handler";
import { runTaskRoute } from "@/lib/tasks/route-deps";

/** Submit the answer to an opened task, once. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id, taskId } = await params;
  return runTaskRoute((deps) => handleSubmitTask(request, id, taskId, deps));
}
