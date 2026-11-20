import { RECOMMENDATION_LABELS, type Recommendation } from "@/lib/evaluation/evaluate";
import { applyOverrides, type ScoreOverride } from "@/lib/evaluation/overrides";
import type { StoredEvaluation } from "@/lib/evaluation/store";

import { OverrideControl } from "./override-control";
import { RunEvaluationButton } from "./run-evaluation-button";

const FAILURE_TEXT: Record<string, string> = {
  no_transcript: "There is no transcript to score.",
  too_short: "The candidate said too little to score fairly.",
  llm_not_configured: "The scoring model is not configured on the server.",
  quota: "The daily model limit was reached when this interview finished.",
  llm_failed: "The scoring model could not score this interview.",
};

const RECOMMENDATION_STYLE: Record<Recommendation, string> = {
  strong_yes: "bg-green-100 text-green-800",
  yes: "bg-emerald-100 text-emerald-800",
  maybe: "bg-amber-100 text-amber-800",
  no: "bg-red-100 text-red-800",
};

function barColor(score: number): string {
  if (score >= 80) return "bg-green-600";
  if (score >= 65) return "bg-emerald-500";
  if (score >= 45) return "bg-amber-500";
  return "bg-red-500";
}

/** The AI rubric score for one interview, with the evidence behind every criterion. */
export function EvaluationPanel({
  sessionId,
  evaluation,
  hasTranscript,
  overrides,
}: {
  sessionId: string;
  evaluation: StoredEvaluation | null;
  hasTranscript: boolean;
  overrides: ScoreOverride[];
}) {
  if (!evaluation) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {hasTranscript
            ? "Not scored yet. Scoring runs automatically when an interview ends."
            : "Nothing to score until the interview has a transcript."}
        </p>
        {hasTranscript && <RunEvaluationButton sessionId={sessionId} hasScore={false} />}
      </div>
    );
  }

  if (evaluation.status === "failed" || evaluation.overallScore === null) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Not scored. {FAILURE_TEXT[evaluation.errorCode ?? ""] ?? "Scoring failed."}
        </p>
        {hasTranscript && <RunEvaluationButton sessionId={sessionId} hasScore={false} />}
      </div>
    );
  }

  const effective = applyOverrides(evaluation.criteria, overrides);
  const recommendation = effective.recommendation;
  const changed = effective.overallScore !== effective.aiOverallScore;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-4 border-primary"
          role="img"
          aria-label={`Overall score ${effective.overallScore} out of 100`}
        >
          <span className="text-2xl font-bold leading-none">{effective.overallScore}</span>
          <span className="text-[10px] uppercase text-muted-foreground">of 100</span>
        </div>
        <div className="grid gap-1">
          {recommendation && (
            <span className={`w-fit rounded-full px-3 py-1 font-ui text-xs font-semibold ${RECOMMENDATION_STYLE[recommendation]}`}>
              {RECOMMENDATION_LABELS[recommendation]}
            </span>
          )}
          <p className="text-xs text-muted-foreground">
            AI-scored against the role&apos;s rubric. A starting point for the reviewer, not a hiring decision.
          </p>
          {changed && (
            <p className="text-xs font-medium text-amber-800">
              Reviewer-adjusted. The AI&apos;s own overall score was {effective.aiOverallScore}.
            </p>
          )}
        </div>
      </div>

      <p className="text-sm">{evaluation.summary}</p>

      <ul className="grid gap-4">
        {effective.criteria.map((c) => (
          <li key={c.name} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">
                {c.name} <span className="text-xs font-normal text-muted-foreground">· weight {c.weight}</span>
              </span>
              <span className="font-semibold tabular-nums">
                {c.override && <span className="mr-2 text-xs font-normal text-muted-foreground line-through">AI {c.aiScore ?? "–"}</span>}
                {c.score === null ? "Not covered" : c.score}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              {c.score !== null && (
                <div className={`h-full rounded-full ${barColor(c.score)}`} style={{ width: `${c.score}%` }} />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{c.evidence}</p>
            {c.override && (
              <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Reviewer set {c.override.score}: {c.override.reason}
              </p>
            )}
            <OverrideControl sessionId={sessionId} criterion={c.name} current={c.score} overridden={c.override !== null} />
          </li>
        ))}
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-green-800">Strengths</h3>
          {evaluation.strengths.length === 0 ? (
            <p className="text-sm text-muted-foreground">None noted.</p>
          ) : (
            <ul className="grid list-disc gap-1 pl-4 text-sm">
              {evaluation.strengths.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase text-red-800">Concerns</h3>
          {evaluation.concerns.length === 0 ? (
            <p className="text-sm text-muted-foreground">None noted.</p>
          ) : (
            <ul className="grid list-disc gap-1 pl-4 text-sm">
              {evaluation.concerns.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {hasTranscript && <RunEvaluationButton sessionId={sessionId} hasScore />}
    </div>
  );
}
