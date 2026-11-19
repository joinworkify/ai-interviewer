import { getCaller } from "@/lib/admin/server";
import { REVIEW_STATUS_LABELS } from "@/lib/admin/access";
import { toCsv } from "@/lib/admin/csv";
import { listAttempts } from "@/lib/admin/data";
import { applyListQuery, parseListQuery } from "@/lib/admin/list-query";
import { listAdmins } from "@/lib/admin/workflow-server";

/** Admins only: the interviews list (same filters as the page) as a CSV download. */
export async function GET(request: Request) {
  const caller = await getCaller();
  if (!caller?.isAdmin) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const query = parseListQuery(Object.fromEntries(url.searchParams));
  const [all, admins] = await Promise.all([listAttempts(), listAdmins().catch(() => [])]);
  const emailById = new Map(admins.map((a) => [a.id, a.email]));
  const rows = applyListQuery(all, query, caller.userId);

  const csv = toCsv(
    ["Name", "Email", "Role", "Interview", "Resume", "AI score", "Review status", "Assigned to", "Problem reported", "Started"],
    rows.map((r) => [
      r.name,
      r.email,
      r.roleTitle,
      r.interviewStatus,
      r.hasResume ? "yes" : "no",
      r.score,
      REVIEW_STATUS_LABELS[r.reviewStatus],
      r.assignedTo ? (emailById.get(r.assignedTo) ?? r.assignedTo) : "",
      r.problemReported ? "yes" : "no",
      r.startedAt,
    ]),
  );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="interviews-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
