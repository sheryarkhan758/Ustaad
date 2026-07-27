/**
 * Review intelligence — §6.9, OBJ-6.
 *
 * §2.5 is the argument this module exists to serve: star ratings compress to a
 * meaningless average, every tutor on every platform in this category sits near
 * 4.7, and the real signal is in the text — which is unstructured,
 * uncomparable, and unweighted by whether the reviewer had one session or
 * thirty.
 *
 * ── The eight dimensions, and where they come from ─────────────────────────
 * FR-9.4 requires "eight defined dimensions" but **the specification never
 * defines them**. Rather than invent eight, they are derived from the
 * document's own words:
 *
 *   1–4 are §2.5 verbatim — "whether the tutor arrives on time, whether they
 *       teach the concept or simply complete the homework, whether they know
 *       the board's paper pattern, whether the student's confidence changed".
 *   5–6 are two of §6.20's named fit-check dimensions (communication, pace),
 *       so a trial and a review describe the same tutor in the same terms.
 *   7–8 close the set: consistency over an engagement (§6.17's concern, from
 *       the family's side rather than the platform's), and whether the
 *       engagement was worth its price — which is §2.7's question and one only
 *       the family can answer.
 *
 * This derivation is flagged in docs/PROGRESS.md so the gap is visible rather
 * than papered over.
 *
 * ── What is model output and what is not ───────────────────────────────────
 * The model **classifies**: sentiment, quoted evidence, specificity per
 * dimension. Everything numeric — the credibility weight, the generic flag, the
 * contradiction flag — is computed **here, in deterministic code**, from the
 * model's classification plus stored booking facts (§7.2, CLAUDE.md §2.9).
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------
 * The eight dimensions
 * ---------------------------------------------------------------------- */

export const REVIEW_DIMENSIONS = [
  'punctuality',
  'teaching_quality',
  'syllabus_command',
  'confidence_change',
  'communication',
  'pace',
  'consistency',
  'value_for_money',
] as const;

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

/** Shown in the interface, and injected into the prompt so both agree. */
export const DIMENSION_LABELS: Record<ReviewDimension, { en: string; ur: string }> = {
  punctuality: { en: 'Punctuality', ur: 'وقت کی پابندی' },
  teaching_quality: { en: 'Teaching quality', ur: 'تدریس کا معیار' },
  syllabus_command: { en: 'Command of the syllabus', ur: 'نصاب پر عبور' },
  confidence_change: { en: "Change in the student's confidence", ur: 'طالب علم کے اعتماد میں تبدیلی' },
  communication: { en: 'Communication', ur: 'رابطہ' },
  pace: { en: 'Pace', ur: 'رفتار' },
  consistency: { en: 'Consistency', ur: 'تسلسل' },
  value_for_money: { en: 'Value for the fee', ur: 'فیس کے مقابلے میں افادیت' },
};

export const SENTIMENTS = ['positive', 'negative', 'mixed', 'not_mentioned'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/* -------------------------------------------------------------------------
 * What the model must return
 * ---------------------------------------------------------------------- */

/**
 * One dimension's classification.
 *
 * `evidence` is a **quotation from the review**, not a paraphrase. A summary in
 * the model's words would be the model's opinion presented as the reviewer's,
 * and FR-9.4 asks for quoted evidence precisely so a reader can check.
 */
export const dimensionAnalysisSchema = z.object({
  sentiment: z.enum(SENTIMENTS),
  /** Verbatim from the review. Empty when the dimension was not mentioned. */
  evidence: z.string().max(400).default(''),
  /** 0 = a bare assertion, 1 = a specific, checkable observation. */
  specificity: z.number().min(0).max(1),
});

export type DimensionAnalysis = z.infer<typeof dimensionAnalysisSchema>;

/**
 * The complete model response.
 *
 * Strict: every dimension must be present, so a partial answer is a parse
 * failure rather than a silently incomplete analysis.
 */
export const reviewAnalysisResponseSchema = z.object({
  dimensions: z.object(
    Object.fromEntries(
      REVIEW_DIMENSIONS.map((d) => [d, dimensionAnalysisSchema]),
    ) as Record<ReviewDimension, typeof dimensionAnalysisSchema>,
  ),
  /** Topic ids or names the reviewer referred to. Free text; matched in code. */
  topicsMentioned: z.array(z.string().max(120)).max(20).default([]),
  /**
   * The model's read on whether the text raises a safety concern.
   *
   * Advisory. The decision to route it privately is taken in code below, and
   * errs towards routing: a false positive costs an administrator a minute, a
   * false negative is a child in a house with someone nobody looked at again.
   */
  safetyConcern: z.boolean().default(false),
  /** Why, in one line. Never shown publicly. */
  safetyConcernReason: z.string().max(300).default(''),
  /** The model's overall read, used only to detect a contradiction. */
  overallSentiment: z.enum(SENTIMENTS),
});

export type ReviewAnalysisResponse = z.infer<typeof reviewAnalysisResponseSchema>;

/* -------------------------------------------------------------------------
 * Credibility — computed in code, never by the model
 * ---------------------------------------------------------------------- */

/** Below this, a review is generic and is down-weighted (FR-9.6). */
export const GENERIC_SPECIFICITY_THRESHOLD = 0.25;
/** Fewer dimensions than this mentioned also reads as generic. */
export const GENERIC_MIN_DIMENSIONS = 2;
/** The floor a generic review is weighted at. Never zero — see below. */
export const GENERIC_WEIGHT = 0.25;

export interface CredibilitySignals {
  /** Completed sessions the reviewer actually had with this tutor (FR-9.5). */
  completedSessions: number;
  /** Mean specificity across the dimensions the reviewer actually addressed. */
  detailLevel: number;
  /** How many of the eight the reviewer addressed at all. */
  dimensionsCovered: number;
  /** FR-9.6. Down-weighted, never hidden and never deleted. */
  generic: boolean;
  /** FR-9.7. Surfaced publicly when the stars and the words disagree. */
  contradiction: boolean;
  /** The multiplier applied in ranking. */
  weight: number;
}

/**
 * Score credibility from the model's classification plus stored facts.
 *
 * Pure and deterministic: the same review and the same booking history always
 * produce the same weight, which is what lets a tutor's score be reconstructed
 * from stored signals (§7.2).
 *
 * **A generic review is weighted down to 0.25, never to 0.** FR-9.6 says
 * generic reviews are never hidden and never deleted, and a weight of zero
 * would delete one in every way that matters to a ranking while leaving it on
 * the page — which is worse than either honest option.
 */
export function computeCredibility(
  analysis: ReviewAnalysisResponse,
  facts: { completedSessions: number; rating: number },
): CredibilitySignals {
  const mentioned = REVIEW_DIMENSIONS.map((d) => analysis.dimensions[d]).filter(
    (d) => d.sentiment !== 'not_mentioned',
  );

  const detailLevel =
    mentioned.length === 0
      ? 0
      : Math.round(
          (mentioned.reduce((total, d) => total + d.specificity, 0) / mentioned.length) * 10_000,
        ) / 10_000;

  const generic =
    detailLevel < GENERIC_SPECIFICITY_THRESHOLD || mentioned.length < GENERIC_MIN_DIMENSIONS;

  // FR-9.7. Five stars and a negative account of the sessions, or one star and
  // a positive one, is information a reader should have — the platform shows
  // the disagreement rather than quietly trusting the number.
  const starsArePositive = facts.rating >= 4;
  const starsAreNegative = facts.rating <= 2;
  const contradiction =
    (starsArePositive && analysis.overallSentiment === 'negative') ||
    (starsAreNegative && analysis.overallSentiment === 'positive');

  // A reviewer with thirty completed sessions saw more than one with a single
  // trial. Capped, so a long engagement does not dominate outright.
  const sessionWeight = Math.min(1, 0.4 + facts.completedSessions * 0.06);

  const base = generic ? GENERIC_WEIGHT : 0.5 + detailLevel * 0.5;
  const weight = Math.round(Math.min(1, base * sessionWeight) * 10_000) / 10_000;

  return {
    completedSessions: facts.completedSessions,
    detailLevel,
    dimensionsCovered: mentioned.length,
    generic,
    contradiction,
    weight: Math.max(GENERIC_WEIGHT * 0.4, weight),
  };
}

/* -------------------------------------------------------------------------
 * What the public sees
 * ---------------------------------------------------------------------- */

export const ANALYSIS_STATUSES = ['pending', 'analysed', 'unanalysed'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export interface PublicReviewDimension {
  dimension: ReviewDimension;
  label: string;
  sentiment: Sentiment;
  /** The reviewer's own words. */
  evidence: string;
}

/**
 * Strip an analysis to what may be shown.
 *
 * `safetyConcernReason` never appears here, and a safety-flagged review is
 * filtered out before this is reached — see `server/repositories/reviews.ts`.
 * The contradiction flag **is** public (FR-9.7); the generic flag is not, since
 * telling a reviewer their review was judged generic serves nobody and its only
 * effect is on the weight.
 */
export function toPublicDimensions(
  analysis: ReviewAnalysisResponse,
): PublicReviewDimension[] {
  return REVIEW_DIMENSIONS.filter((d) => analysis.dimensions[d].sentiment !== 'not_mentioned').map(
    (dimension) => ({
      dimension,
      label: DIMENSION_LABELS[dimension].en,
      sentiment: analysis.dimensions[dimension].sentiment,
      evidence: analysis.dimensions[dimension].evidence,
    }),
  );
}

export const createReviewSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  /**
   * Urdu script, Roman Urdu, English or any mixture (FR-9.2).
   *
   * Stored byte-for-byte as written. Never normalised, transliterated or
   * machine translated — translating a reviewer's words would misrepresent them
   * (decision 13, CLAUDE.md §2.10).
   */
  text: z.string().trim().min(1).max(4000).optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
