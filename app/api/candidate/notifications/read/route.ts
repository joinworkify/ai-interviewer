import { handleMarkInboxRead } from "@/lib/candidate/inbox";
import { runInboxRoute } from "@/lib/candidate/inbox-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Mark all of the signed-in candidate's notifications as read. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runInboxRoute((deps) => handleMarkInboxRead(deps));
}
