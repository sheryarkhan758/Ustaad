/**
 * The competency rubric — FR-11.5, §7.2.
 *
 * The model classifies. This file computes. That split is the whole point: the
 * verdict decides whether someone may advertise a subject and earn from it, so
 * it has to be reproducible, inspectable and identical for two tutors who
 * answered equally well. A model asked for "a score out of 100" gives neither.
 *
 * Pure. No database, no clock, no randomness — the same classifications always
 * produce the same score and the same verdict, which is what makes an appeal
 * (SEC-18) something a human can actually check.
 */

import type { ItemGrade } from './ai-contract';

export const EXPLANATION_QUALITIES = ['none', 'weak', 'adequate', 'strong'] as const;
export type ExplanationQuality = (typeof EXPLANATION_QUALITIES)[number];

/**
 * Weights, out of 100 per item.
 *
 * Explanation outweighs correctness deliberately. A tutor who gets the answer
 * right and cannot make a struggling fifteen-year-old see it is the failure
 * this platform exists to detect; the market already rewards the credential.
 */
export const RUBRIC = Object.freeze({
  correct: 40,
  explanation: Object.freeze({ none: 0, weak: 12, adequate: 28, strong: 40 }),
  pitchedForStudent: 20,
});

export const VERDICT_THRESHOLDS = Object.freeze({
  /** ≥ 70 → the claim is marked verified. */
  pass: 70,
  /** ≥ 50 → partial: shown to the tutor, never enough to verify a claim. */
  partial: 50,
});

export type CompetencyVerdict = 'pass' | 'partial' | 'fail' | 'inconclusive';

export interface CompetencyResult {
  /** 0–100, rounded to one decimal so it is stable across engines. */
  score: number;
  verdict: CompetencyVerdict;
  perItem: { itemId: string; points: number }[];
}

/** Score one item, 0–100. */
function scoreItem(grade: ItemGrade): number {
  return (
    (grade.correct ? RUBRIC.correct : 0) +
    RUBRIC.explanation[grade.explanationQuality] +
    (grade.pitchedForStudent ? RUBRIC.pitchedForStudent : 0)
  );
}

/**
 * The mean of the per-item scores, and the verdict that follows from it.
 *
 * No grades at all is `inconclusive`, not `fail`. The distinction matters: a
 * failed attempt is a judgement about the tutor, an inconclusive one is an
 * admission about the platform, and only the first should cost them anything.
 */
export function computeCompetency(grades: ItemGrade[]): CompetencyResult {
  if (grades.length === 0) {
    return { score: 0, verdict: 'inconclusive', perItem: [] };
  }

  const perItem = grades.map((g) => ({ itemId: g.itemId, points: scoreItem(g) }));
  const mean = perItem.reduce((sum, i) => sum + i.points, 0) / perItem.length;
  const score = Math.round(mean * 10) / 10;

  const verdict: CompetencyVerdict =
    score >= VERDICT_THRESHOLDS.pass
      ? 'pass'
      : score >= VERDICT_THRESHOLDS.partial
        ? 'partial'
        : 'fail';

  return { score, verdict, perItem };
}

/**
 * What the tutor is told, in words, with the figure the rubric produced.
 *
 * Built here rather than by the model, so the number in the sentence is the
 * number in the database (FR-11.7).
 */
export function describeVerdict(result: CompetencyResult, topicName: string): string {
  switch (result.verdict) {
    case 'pass':
      return `Passed assessment: ${topicName} (${result.score}/100).`;
    case 'partial':
      return `Assessment for ${topicName} scored ${result.score}/100, below the ${VERDICT_THRESHOLDS.pass} needed to verify the claim. You can re-attempt with different questions.`;
    case 'fail':
      return `Assessment for ${topicName} scored ${result.score}/100. The claim stays unverified. You can re-attempt with different questions, or appeal for a human review.`;
    case 'inconclusive':
      return `The assessment for ${topicName} could not be completed. Nothing has been recorded against your profile — please try again.`;
  }
}
