import { guardSameOrigin } from "@/lib/http/origin-guard";
import { handleReportIntegrity } from "@/lib/integrity/handler";
import { runIntegrityRoute } from "@/lib/integrity/route-deps";

/** The candidate's browser reports integrity signals (tab switches and the like). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runIntegrityRoute((deps) => handleReportIntegrity(request, id, deps));
}
