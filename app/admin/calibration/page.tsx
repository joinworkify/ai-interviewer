import { Suspense } from "react";

import { CaseActions, NewCaseForm } from "@/components/admin/calibration-forms";
import { requireAdmin } from "@/lib/admin/server";
import { loadCalibration } from "@/lib/evaluation/calibration-data";

async function CalibrationContent() {
  await requireAdmin();
  const { report, distribution, prepared } = await loadCalibration();

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">Scoring calibration</h1>
        <p className="text-sm text-muted-foreground">
          Check how close the AI&apos;s scores are to your reviewers&apos;. Add interviews a person already scored, run the AI on them,
          and compare.
        </p>
      </div>

      <section className="grid gap-3 rounded-xl border bg-white p-5 dark:bg-card">
        <h2 className="text-lg font-semibold">Accuracy against people</h2>
        {report.casesCompared === 0 ? (
          <p className="text-sm text-muted-foreground">Add a case and run the AI on it to see how it compares.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Cases compared", String(report.casesCompared)],
                ["Average gap (points)", String(report.overallMeanAbsError)],
                ["AI vs people", `${(report.overallBias ?? 0) > 0 ? "+" : ""}${report.overallBias} (+ means more generous)`],
                ["Within 10 points", `${Math.round((report.within10 ?? 0) * 100)}%`],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase text-muted-foreground">{k}</dt>
                  <dd className="text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {report.maxRepeatSpread !== null && (
              <p className="text-sm">
                Stability: scoring the same case repeatedly varied by up to <strong>{report.maxRepeatSpread}</strong> points.
              </p>
            )}
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Criterion</th>
                  <th>Cases</th>
                  <th>Average gap</th>
                  <th>AI vs people</th>
                </tr>
              </thead>
              <tbody>
                {report.perCriterion.map((c) => (
                  <tr key={c.name} className="border-b last:border-0">
                    <td className="py-2">{c.name}</td>
                    <td>{c.n}</td>
                    <td>{c.meanAbsError}</td>
                    <td>{c.bias > 0 ? "+" : ""}{c.bias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <NewCaseForm />

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Cases</h2>
        {prepared.length === 0 && <p className="text-sm text-muted-foreground">No cases yet.</p>}
        {prepared.map(({ c, runs: caseRuns, humanOverall }) => {
          const latest = caseRuns[caseRuns.length - 1];
          return (
            <div key={c.id} className="grid gap-2 rounded-xl border bg-white p-4 dark:bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium">{c.title}</p>
                  <p className="text-xs text-muted-foreground">{c.role_title}</p>
                </div>
                <p className="text-sm">
                  People: <strong>{humanOverall ?? "–"}</strong> · AI: <strong>{latest ? latest.overall : "not run"}</strong>
                  {caseRuns.length > 1 && <span className="text-muted-foreground"> ({caseRuns.length} runs)</span>}
                </p>
              </div>
              <CaseActions id={c.id} />
            </div>
          );
        })}
      </section>

      <section className="grid gap-3 rounded-xl border bg-white p-5 dark:bg-card">
        <h2 className="text-lg font-semibold">Score spread by role</h2>
        <p className="text-sm text-muted-foreground">
          The AI&apos;s scores on real interviews. A role whose average or spread is far from the others deserves a look at its rubric.
          This is not a fairness audit: we do not collect gender, ethnicity or nationality, so scores cannot be compared across groups.
          Do that with a legal basis and a separate, consented data set before relying on this for high-stakes hiring.
        </p>
        {distribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scored interviews yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2">Role</th>
                <th>Interviews</th>
                <th>Average</th>
                <th>Lowest</th>
                <th>Highest</th>
                <th>Spread (std dev)</th>
              </tr>
            </thead>
            <tbody>
              {distribution.map((d) => (
                <tr key={d.role} className="border-b last:border-0">
                  <td className="py-2">{d.role}</td>
                  <td>{d.n}</td>
                  <td>{d.mean}</td>
                  <td>{d.min}</td>
                  <td>{d.max}</td>
                  <td>{d.stdDev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export default function CalibrationPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <CalibrationContent />
    </Suspense>
  );
}

export const metadata = { title: "Calibration" };
