import { handleListInbox } from "@/lib/candidate/inbox";
import { runInboxRoute } from "@/lib/candidate/inbox-route-deps";

/** The signed-in candidate's latest notifications and unread count. */
export async function GET(request: Request) {
  void request.headers.get("cookie"); // per request, never prerendered
  return runInboxRoute((deps) => handleListInbox(deps));
}
