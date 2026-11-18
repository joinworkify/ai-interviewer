import Link from "next/link";
import { Suspense } from "react";

import {
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  isReviewStatus,
} from "@/lib/admin/access";
import { listAttempts } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/admin/server";
import AdminFilters from "./admin-filters";

const PAGE_SIZE = 10;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function AdminPageContent({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireAdmin();
  const { status, q, page: pageParam } = await searchParams;
  const statusFilter = isReviewStatus(status) ? status : null;
  const query = (q ?? "").trim().toLowerCase();

  const all = await listAttempts();
  const rows = all.filter(
    (r) =>
      (!statusFilter || r.reviewStatus === statusFilter) &&
      (!query ||
        (r.name ?? "").toLowerCase().includes(query) ||
        (r.email ?? "").toLowerCase().includes(query)),
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const requested = Number.parseInt(pageParam ?? "1", 10);
  const page = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 1, 1),
    pageCount,
  );
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", q!.trim());
    if (statusFilter) params.set("status", statusFilter);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };
  const counts = Object.fromEntries(
    REVIEW_STATUSES.map((s) => [
      s,
      all.filter((r) => r.reviewStatus === s).length,
    ]),
  );

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Candidate interviews</h1>
        <p className="text-sm text-muted-foreground">
          Review resumes and interviews, and set each one&apos;s status.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {REVIEW_STATUSES.map((s) => (
          <Link
            key={s}
            href={statusFilter === s ? "/admin" : `/admin?status=${s}`}
            className={`rounded-xl border bg-white p-4 hover:border-primary ${statusFilter === s ? "border-primary ring-1 ring-primary" : ""}`}
          >
            <div className="text-sm text-muted-foreground">
              {REVIEW_STATUS_LABELS[s]}
            </div>
            <div className="text-2xl font-bold">{counts[s]}</div>
          </Link>
        ))}
      </div>

      <AdminFilters />

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Interview</th>
              <th className="px-4 py-3">Resume</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No interviews found.
                </td>
              </tr>
            )}
            {pageRows.map((r) => (
              <tr
                key={r.sessionId}
                className="border-b last:border-0 hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{r.name || "No name"}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </td>
                <td className="px-4 py-3">{r.roleTitle ?? "â€”"}</td>
                <td className="px-4 py-3 capitalize">
                  {r.interviewStatus.replace("_", " ")}
                </td>
                <td className="px-4 py-3">{r.hasResume ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 font-ui text-xs font-medium ${STATUS_STYLE[r.reviewStatus]}`}
                  >
                    {REVIEW_STATUS_LABELS[r.reviewStatus]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {formatDate(r.startedAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/sessions/${r.sessionId}`}
                    className="font-medium text-primary hover:underline"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <nav
          aria-label="Pagination"
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
        >
          <p className="text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}â€“
            {Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md border bg-background px-3 py-2 hover:border-primary"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-md border bg-background px-3 py-2 opacity-50">
                Previous
              </span>
            )}
            <span className="px-1 text-muted-foreground">
              Page {page} of {pageCount}
            </span>
            {page < pageCount ? (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md border bg-background px-3 py-2 hover:border-primary"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-md border bg-background px-3 py-2 opacity-50">
                Next
              </span>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

export default function AdminPage(props: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">Loadingâ€¦</p>}
    >
      <AdminPageContent {...props} />
    </Suspense>
  );
}

export const metadata = { title: "Interviews" };
