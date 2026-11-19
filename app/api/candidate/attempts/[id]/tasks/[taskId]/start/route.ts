import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleStartTask } from "@/lib/tasks/handler";
import { runTaskRoute } from "@/lib/tasks/route-deps";

/** Open a task: the time limit counts from the first call. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id, taskId } = await params;
  return runTaskRoute((deps) => handleStartTask(id, taskId, deps));
}
