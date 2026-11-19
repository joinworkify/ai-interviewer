import { handleListTasks } from "@/lib/tasks/handler";
import { runTaskRoute } from "@/lib/tasks/route-deps";

/** The role's tasks for the signed-in candidate's own attempt. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  void request.headers.get("cookie"); // per request, never prerendered
  const { id } = await params;
  return runTaskRoute((deps) => handleListTasks(id, deps));
}
