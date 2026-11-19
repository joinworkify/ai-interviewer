import { overallScore, recommendationFor, type CriterionScore, type Recommendation } from "./evaluate";

/**
 * A reviewer's override of one criterion's score. The AI score is never
 * changed: the page shows both, and the effective score (used for the overall
 * number and the list) takes the override, with the reason kept beside it.
 *
 * Client-safe (no server imports).
 */

export interface ScoreOverride {
  criterion: string;
  score: number;
  reason: string;
  updatedAt: string;
}

export interface EffectiveCriterion extends CriterionScore {
  /** The AI's own score, kept even when overridden. */
  aiScore: number | null;
  override: { score: number; reason: string; updatedAt: string } | null;
}

export interface EffectiveEvaluation {
  criteria: EffectiveCriterion[];
  overallScore: number;
  recommendation: Recommendation;
  /** The AI-only overall, for comparison when something is overridden. */
  aiOverallScore: number;
}

export function applyOverrides(criteria: readonly CriterionScore[], overrides: readonly ScoreOverride[]): EffectiveEvaluation {
  const byName = new Map(overrides.map((o) => [o.criterion.toLowerCase(), o]));
  const effective: EffectiveCriterion[] = criteria.map((c) => {
    const o = byName.get(c.name.toLowerCase());
    return {
      ...c,
      aiScore: c.score,
      score: o ? o.score : c.score,
      override: o ? { score: o.score, reason: o.reason, updatedAt: o.updatedAt } : null,
    };
  });
  const overall = overallScore(effective);
  return {
    criteria: effective,
    overallScore: overall,
    recommendation: recommendationFor(overall),
    aiOverallScore: overallScore(criteria),
  };
}

export const MAX_REASON = 500;

export type OverrideBody =
  | { ok: true; criterion: string; score: number; reason: string }
  | { ok: false; message: string };

export function parseOverrideBody(value: unknown): OverrideBody {
  const v = (value ?? {}) as Record<string, unknown>;
  const criterion = typeof v.criterion === "string" ? v.criterion.trim() : "";
  if (!criterion || criterion.length > 60) return { ok: false, message: "Choose a criterion." };
  if (typeof v.score !== "number" || !Number.isInteger(v.score) || v.score < 0 || v.score > 100) {
    return { ok: false, message: "The score must be a whole number from 0 to 100." };
  }
  const reason = typeof v.reason === "string" ? v.reason.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!reason) return { ok: false, message: "Say why you are changing the score." };
  if (reason.length > MAX_REASON) return { ok: false, message: `The reason must be at most ${MAX_REASON} characters.` };
  return { ok: true, criterion, score: v.score, reason };
}
