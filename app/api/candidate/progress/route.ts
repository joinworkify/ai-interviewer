import { connection } from "next/server";

import { handleGetProgress } from "@/lib/candidate/progress";
import { runProgressRoute } from "@/lib/candidate/progress-route-deps";

/** Where the signed-in candidate is in the application for one role. Read-only, so no origin guard. */
export async function GET(request: Request) {
  // Per-request data: keep Next from running this at build time.
  await connection();
  return runProgressRoute((deps) => handleGetProgress(request, deps));
}
