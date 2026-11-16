import { handleSaveProfile } from "@/lib/candidate/profile";
import { runProfileRoute } from "@/lib/candidate/profile-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Save the signed-in candidate's contact details. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runProfileRoute((deps) => handleSaveProfile(request, deps));
}
