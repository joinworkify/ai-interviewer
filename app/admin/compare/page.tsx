import Link from "next/link";
import { Suspense } from "react";

import { REVIEW_STATUS_LABELS } from "@/lib/admin/access";
import { loadCompare, MAX_COMPARE } from "@/lib/admin/compare";
import { requireAdmin } from "@/lib/admin/server";
import { RECOMMENDATION_LABELS } from "@/lib/evaluation/evaluate";
import { isUuid } from "@/lib/sessions/validation";

async function CompareContent({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requireAdmin();
  const { ids: raw } = await searchParams;
  const ids = [...new Set((raw ?? "").split(",").filter(isUuid))].slice(0, MAX_COMPARE);
  const columns = ids.length >= 2 ? await loadCompare(ids) : [];

  if (columns.length < 2) {
    return (
      <>
        <Link href="/admin" className="text-sm text-primary hover:underline">← All interviews</Link>
        <p className="text-sm text-muted-foreground">Tick 2 to {MAX_COMPARE} interviews on the list and press Compare.</p>
      </>
    );
  }
  // Criteria in the order first seen; a candidate's missing criterion shows a dash.
  const criteria = [...new Set(columns.flatMap((c) => Object.keys(c.scores)))];
  const best = Math.max(...columns.map((c) => c.overall ?? -1));

  return (
    <>
      <Link href="/admin" className="text-sm text-primary hover:underline">← All interviews</Link>
      <h1 className="text-2xl font-bold">Compare candidates</h1>
      <div className="overflow-x-auto rounded-xl border bg-white dark:bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3" />
              {columns.map((c) => (
                <th key={c.sessionId} className="px-4 py-3 align-top normal-case">
                  <Link href={`/admin/sessions/${c.sessionId}`} className="text-base font-semibold text-foreground hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs font-normal text-muted-foreground">{c.roleTitle ?? "Unknown role"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <th className="px-4 py-3 text-xs uppercase text-muted-foreground">Overall</th>
              {columns.map((c) => (
                <td key={c.sessionId} className="px-4 py-3 text-lg font-bold tabular-nums">
                  {c.overall ?? "—"}
                  {c.overall !== null && c.overall === best && <span className="ml-2 text-xs font-medium text-green-700">highest</span>}
                  {c.overall !== null && c.aiOverall !== null && c.overall !== c.aiOverall && (
                    <div className="text-xs font-normal text-muted-foreground">AI said {c.aiOverall}</div>
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-b">
              <th className="px-4 py-3 text-xs uppercase text-muted-foreground">Recommendation</th>
              {columns.map((c) => (
                <td key={c.sessionId} className="px-4 py-3">{c.recommendation ? RECOMMENDATION_LABELS[c.recommendation] : "—"}</td>
              ))}
            </tr>
            {criteria.map((name) => (
              <tr key={name} className="border-b">
                <th className="px-4 py-3 text-xs uppercase text-muted-foreground">{name}</th>
                {columns.map((c) => (
                  <td key={c.sessionId} className="px-4 py-3 tabular-nums">
                    {name in c.scores ? (c.scores[name] ?? "Not covered") : "—"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-b">
              <th className="px-4 py-3 text-xs uppercase text-muted-foreground">Integrity signals</th>
              {columns.map((c) => (
                <td key={c.sessionId} className="px-4 py-3 capitalize">{c.integrity === "none" ? "None" : c.integrity}</td>
              ))}
            </tr>
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-muted-foreground">Review status</th>
              {columns.map((c) => (
                <td key={c.sessionId} className="px-4 py-3">{REVIEW_STATUS_LABELS[c.reviewStatus]}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Scores are the AI&apos;s with any reviewer overrides applied. Different roles use different rubrics, so compare people for the same role.
      </p>
    </>
  );
}

export default function ComparePage(props: { searchParams: Promise<{ ids?: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <CompareContent {...props} />
    </Suspense>
  );
}

export const metadata = { title: "Compare" };
