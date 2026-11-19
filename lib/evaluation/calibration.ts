import type { RubricCriterion } from "./rubric";

/**
 * Calibration: transcripts a person scored, and how far the AI's scores are
 * from theirs. Pure arithmetic, client-safe. "Error" is AI minus human, so a
 * positive average error means the AI is more generous than people.
 */

export interface CaseRun {
  /** Criterion name -> AI score (null = the AI said it was not covered). */
  aiScores: Record<string, number | null>;
  overall: number;
}

export interface CalibrationCase {
  humanScores: Record<string, number>;
  rubric: readonly RubricCriterion[];
  runs: readonly CaseRun[];
}

export interface CriterionStat {
  name: string;
  /** Cases where both a human and the AI gave a score. */
  n: number;
  /** Mean of |AI - human|. */
  meanAbsError: number;
  /** Mean of (AI - human); positive = AI more generous. */
  bias: number;
}

export interface CalibrationReport {
  casesCompared: number;
  /** Mean absolute error of the weighted overall score, 0-100. */
  overallMeanAbsError: number | null;
  overallBias: number | null;
  /** Share of cases whose overall is within 10 points of the human overall. */
  within10: number | null;
  perCriterion: CriterionStat[];
  /** Largest max-min spread of the overall score across repeat runs of one case. */
  maxRepeatSpread: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function weightedOverall(scores: Record<string, number | null | undefined>, rubric: readonly RubricCriterion[]): number | null {
  let total = 0;
  let weights = 0;
  for (const c of rubric) {
    const s = scores[c.name];
    if (typeof s !== "number") continue;
    total += s * c.weight;
    weights += c.weight;
  }
  return weights === 0 ? null : Math.round(total / weights);
}

/** Compares each case's latest run with its human scores. */
export function calibrationReport(cases: readonly CalibrationCase[]): CalibrationReport {
  const crit = new Map<string, { abs: number; signed: number; n: number }>();
  const overallErrors: number[] = [];
  let maxSpread: number | null = null;

  for (const c of cases) {
    if (c.runs.length > 1) {
      const overalls = c.runs.map((r) => r.overall);
      const spread = Math.max(...overalls) - Math.min(...overalls);
      maxSpread = maxSpread === null ? spread : Math.max(maxSpread, spread);
    }
    const latest = c.runs[c.runs.length - 1];
    if (!latest) continue;
    const humanOverall = weightedOverall(c.humanScores, c.rubric);
    if (humanOverall !== null) overallErrors.push(latest.overall - humanOverall);
    for (const r of c.rubric) {
      const human = c.humanScores[r.name];
      const ai = latest.aiScores[r.name];
      if (typeof human !== "number" || typeof ai !== "number") continue;
      const s = crit.get(r.name) ?? { abs: 0, signed: 0, n: 0 };
      s.abs += Math.abs(ai - human);
      s.signed += ai - human;
      s.n += 1;
      crit.set(r.name, s);
    }
  }

  const n = overallErrors.length;
  return {
    casesCompared: n,
    overallMeanAbsError: n ? round1(overallErrors.reduce((a, e) => a + Math.abs(e), 0) / n) : null,
    overallBias: n ? round1(overallErrors.reduce((a, e) => a + e, 0) / n) : null,
    within10: n ? round1(overallErrors.filter((e) => Math.abs(e) <= 10).length / n) : null,
    perCriterion: [...crit.entries()]
      .map(([name, s]) => ({ name, n: s.n, meanAbsError: round1(s.abs / s.n), bias: round1(s.signed / s.n) }))
      .sort((a, b) => b.meanAbsError - a.meanAbsError),
    maxRepeatSpread: maxSpread,
  };
}

export interface RoleDistribution {
  role: string;
  n: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
}

/** Score spread per role across real interviews, to spot a role the AI treats very differently. */
export function scoreDistribution(rows: readonly { role: string; score: number }[]): RoleDistribution[] {
  const byRole = new Map<string, number[]>();
  for (const r of rows) byRole.set(r.role, [...(byRole.get(r.role) ?? []), r.score]);
  return [...byRole.entries()]
    .map(([role, scores]) => {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
      return {
        role,
        n: scores.length,
        mean: round1(mean),
        min: Math.min(...scores),
        max: Math.max(...scores),
        stdDev: round1(Math.sqrt(variance)),
      };
    })
    .sort((a, b) => b.n - a.n);
}

export const MAX_TRANSCRIPT_CHARS_CASE = 20_000;

export function parseHumanScores(
  value: unknown,
  rubric: readonly RubricCriterion[],
): { ok: true; scores: Record<string, number> } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "Send a score for each criterion." };
  const v = value as Record<string, unknown>;
  const scores: Record<string, number> = {};
  for (const c of rubric) {
    const s = v[c.name];
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 100) {
      return { ok: false, message: `Score for "${c.name}" must be a whole number from 0 to 100.` };
    }
    scores[c.name] = s;
  }
  return { ok: true, scores };
}
