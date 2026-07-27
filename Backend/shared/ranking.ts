/**
 * Deterministic ranking — §6.7 FR-7.5, §6.22, §7.2.
 *
 * > The model classifies, narrates and sequences. The application code
 * > computes, validates and enforces.
 *
 * **No model is called in the search path**, and no figure here comes from one.
 * Every input is a materialised column; this module combines them with a fixed
 * weighted sum and returns the arithmetic alongside the answer.
 *
 * Three properties the rest of the system depends on:
 *
 *  · **Reproducible.** Same inputs, same score, every time. There is no clock
 *    read, no random source, and no map iteration order that could vary.
 *  · **Auditable.** `breakdown` carries every term, its raw input, its weight
 *    and its contribution, so a score can be reconstructed from stored signals.
 *  · **Explainable without recomputation.** The narration component (§6.22) is
 *    handed this breakdown and is forbidden from introducing any figure absent
 *    from it (FR-22.4). It never re-runs the maths and never sees the tutor.
 *
 * Gender is **not** here, and must never be added. It is a hard exclusion
 * applied in the SQL predicate before anything is ranked (FR-16.3). A tutor who
 * does not match is absent, not scored low — see `server/repositories/search.ts`.
 */

/* -------------------------------------------------------------------------
 * Weights
 * ---------------------------------------------------------------------- */

/**
 * The weighted sum, summing to 1.
 *
 * Ordered by how much a family can actually act on the signal. Competency and
 * verification lead because they are what the platform exists to establish;
 * recency is last because "logged in recently" says little about teaching.
 */
export const RANKING_WEIGHTS = Object.freeze({
  /** Artefacts an administrator itemised as checked (FR-6.5). */
  verification: 0.2,
  /** Per-topic assessment verdicts, or the roll-up when no topic is filtered. */
  competency: 0.25,
  /** Structured review dimensions, generic reviews down-weighted (FR-9.6). */
  reviews: 0.2,
  /** Confirmation, on-time, completion, cancellation (§6.17). */
  reliability: 0.15,
  /** Same area, or adjacent scaled by travel minutes (FR-2.9, FR-7.7). */
  proximity: 0.1,
  /** Position against the local median (§6.19). */
  ratePosition: 0.07,
  /** Decayed from last activity. */
  recency: 0.03,
} as const);

export type RankingTerm = keyof typeof RANKING_WEIGHTS;

export const RANKING_TERMS = Object.keys(RANKING_WEIGHTS) as RankingTerm[];

/** Guards against a weight edit that silently changes the scale. */
export const WEIGHTS_SUM = Object.values(RANKING_WEIGHTS).reduce((a, b) => a + b, 0);

/** Every artefact checked is worth this much, capped at 1. */
const ARTEFACT_VALUE = 1 / 3;

/** Beyond this many minutes, an adjacent area contributes nothing. */
export const MAX_TRAVEL_MINUTES = 45;

/* -------------------------------------------------------------------------
 * Inputs — every one of these is read from a materialised table
 * ---------------------------------------------------------------------- */

export interface RankingInputs {
  /** `tutor_search_signals.artefacts_checked_count` (0–3). */
  artefactsCheckedCount: number;
  /** `tutor_scores.composite_score` for the filtered topic, else the roll-up. */
  competencyScore: number;
  /** Whether that competency figure is a live per-topic verdict. */
  competencyIsTopicSpecific: boolean;
  /** `tutor_search_signals.overall_score`, review-derived and weighted. */
  reviewScore: number;
  /** `tutor_search_signals.weighted_review_count` — generic already discounted. */
  weightedReviewCount: number;

  /** From `tutor_reliability`. Null when the job has not run for this tutor. */
  confirmationRate: number | null;
  onTimeRate: number | null;
  completionRate: number | null;
  cancellationRate: number | null;

  /**
   * From `area_adjacency.travel_minutes`. `0` for the searched area itself,
   * `null` when the tutor serves neither it nor an adjacent one.
   */
  travelMinutes: number | null;

  /** Paisa. The tutor's applicable normalised hourly rate. */
  normalisedHourly: number | null;
  /** Paisa. `rate_benchmarks.median_hourly`, or null below the SEC-17 cohort. */
  benchmarkMedian: number | null;

  /** `tutor_search_signals.recency_score`, already decayed by the job. */
  recencyScore: number;
}

export interface BreakdownTerm {
  term: RankingTerm;
  /** The 0–1 normalised value this term contributed. */
  value: number;
  weight: number;
  /** `value × weight`, rounded to four places. */
  contribution: number;
  /** The materialised figures behind `value`, for the narration to quote. */
  inputs: Record<string, number | string | null>;
  /** Why the term scored what it did, in words a person can check. */
  note: string;
}

export interface RankingBreakdown {
  score: number;
  terms: BreakdownTerm[];
  /** Stated so a reader knows nothing else went into it. */
  weights: typeof RANKING_WEIGHTS;
  /** Named so a stored breakdown can be matched to the code that made it. */
  algorithmVersion: string;
}

export const RANKING_ALGORITHM_VERSION = 'deterministic-v1';

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/* -------------------------------------------------------------------------
 * The terms
 * ---------------------------------------------------------------------- */

/**
 * Reliability, from four materialised rates.
 *
 * Missing statistics score **0.5, not 0**. A tutor approved yesterday has no
 * booking history, and ranking them below someone with a poor record would
 * make the platform impossible to join — the cold-start problem is a fairness
 * problem here, not just a product one. Neutral is the honest position: the
 * platform does not know yet.
 */
function reliabilityTerm(input: RankingInputs): { value: number; note: string } {
  const parts: number[] = [];
  if (input.confirmationRate !== null) parts.push(clamp01(input.confirmationRate));
  if (input.onTimeRate !== null) parts.push(clamp01(input.onTimeRate));
  if (input.completionRate !== null) parts.push(clamp01(input.completionRate));
  if (input.cancellationRate !== null) parts.push(clamp01(1 - input.cancellationRate));

  if (parts.length === 0) {
    return { value: 0.5, note: 'No booking history yet, so this is scored neutrally.' };
  }

  const value = parts.reduce((a, b) => a + b, 0) / parts.length;
  return {
    value,
    note: `Mean of ${parts.length} reliability measure(s) from completed bookings.`,
  };
}

/**
 * Proximity, from `area_adjacency`.
 *
 * The searched area itself scores 1. An adjacent area decays linearly to 0 at
 * 45 minutes. Anywhere else scores 0 — but note it is a *ranking* term, not a
 * filter: a tutor outside the area is only in the result set at all because the
 * caller asked to include adjacent areas.
 */
function proximityTerm(input: RankingInputs): { value: number; note: string } {
  if (input.travelMinutes === null) {
    return { value: 0, note: 'Does not serve the searched area or one adjacent to it.' };
  }
  if (input.travelMinutes === 0) {
    return { value: 1, note: 'Serves the searched area directly.' };
  }
  const value = clamp01(1 - input.travelMinutes / MAX_TRAVEL_MINUTES);
  return {
    value,
    note: `Serves an adjacent area, about ${input.travelMinutes} minutes away.`,
  };
}

/**
 * Rate position against the local median (§6.19).
 *
 * At or below the median scores 1; above it decays, reaching 0 at twice the
 * median. Deliberately **not** "cheapest wins": the platform's whole argument
 * is that price is only comparable once normalised, and a race to the bottom
 * would penalise the verified, experienced tutors it exists to surface. This
 * term is also the lightest of the four substantive ones.
 *
 * Scores neutral when no benchmark is published — a cohort below four is
 * suppressed to prevent an individual's rate being inferred (SEC-17), and an
 * unpublished cell must not become a ranking penalty.
 */
function ratePositionTerm(input: RankingInputs): { value: number; note: string } {
  if (input.normalisedHourly === null) {
    return { value: 0.5, note: 'No published rate for these filters.' };
  }
  if (input.benchmarkMedian === null || input.benchmarkMedian <= 0) {
    return {
      value: 0.5,
      note: 'No local benchmark is published for this subject, level and area yet.',
    };
  }

  const ratio = input.normalisedHourly / input.benchmarkMedian;
  if (ratio <= 1) {
    return { value: 1, note: 'At or below the local median rate.' };
  }
  const value = clamp01(1 - (ratio - 1));
  return { value, note: `About ${Math.round((ratio - 1) * 100)}% above the local median rate.` };
}

/* -------------------------------------------------------------------------
 * The score
 * ---------------------------------------------------------------------- */

/**
 * Score one tutor.
 *
 * Pure: no clock, no randomness, no I/O. Called once per candidate row over
 * data already fetched, so it adds no query to the request path.
 */
export function rankTutor(input: RankingInputs): RankingBreakdown {
  const verificationValue = clamp01(input.artefactsCheckedCount * ARTEFACT_VALUE);
  const competencyValue = clamp01(input.competencyScore);
  const reviewValue = clamp01(input.reviewScore);
  const reliability = reliabilityTerm(input);
  const proximity = proximityTerm(input);
  const ratePosition = ratePositionTerm(input);
  const recencyValue = clamp01(input.recencyScore);

  const raw: Record<RankingTerm, { value: number; inputs: BreakdownTerm['inputs']; note: string }> =
    {
      verification: {
        value: verificationValue,
        inputs: { artefactsCheckedCount: input.artefactsCheckedCount },
        note: `${input.artefactsCheckedCount} of 3 identity artefacts checked by an administrator.`,
      },
      competency: {
        value: competencyValue,
        inputs: {
          competencyScore: round4(input.competencyScore),
          scope: input.competencyIsTopicSpecific ? 'this topic' : 'all topics',
        },
        note: input.competencyIsTopicSpecific
          ? 'Assessment verdict for the topic you searched for.'
          : 'Roll-up across every topic this tutor has been assessed on.',
      },
      reviews: {
        value: reviewValue,
        inputs: {
          reviewScore: round4(input.reviewScore),
          weightedReviewCount: round4(input.weightedReviewCount),
        },
        note: `From ${round4(input.weightedReviewCount)} credibility-weighted review(s); generic reviews count for less.`,
      },
      reliability: {
        value: reliability.value,
        inputs: {
          confirmationRate: input.confirmationRate,
          onTimeRate: input.onTimeRate,
          completionRate: input.completionRate,
          cancellationRate: input.cancellationRate,
        },
        note: reliability.note,
      },
      proximity: {
        value: proximity.value,
        inputs: { travelMinutes: input.travelMinutes },
        note: proximity.note,
      },
      ratePosition: {
        value: ratePosition.value,
        inputs: {
          normalisedHourly: input.normalisedHourly,
          benchmarkMedian: input.benchmarkMedian,
        },
        note: ratePosition.note,
      },
      recency: {
        value: recencyValue,
        inputs: { recencyScore: round4(input.recencyScore) },
        note: 'How recently this tutor was active on the platform.',
      },
    };

  // Fixed order, from the frozen weights object — never a Map or an object
  // whose key order could vary, because the breakdown must be reproducible.
  const terms: BreakdownTerm[] = RANKING_TERMS.map((term) => {
    const weight = RANKING_WEIGHTS[term];
    const { value, inputs, note } = raw[term];
    return {
      term,
      value: round4(value),
      weight,
      contribution: round4(value * weight),
      inputs,
      note,
    };
  });

  const score = round4(terms.reduce((total, t) => total + t.contribution, 0));

  return {
    score,
    terms,
    weights: RANKING_WEIGHTS,
    algorithmVersion: RANKING_ALGORITHM_VERSION,
  };
}

/**
 * Total order over ranked results.
 *
 * Score descending, then **tutor id ascending** as a tiebreaker. The tiebreaker
 * is not decoration: without it two equally-scored tutors swap places between
 * requests, so page 2 can repeat a tutor from page 1 and omit another entirely.
 */
export function compareRanked<T extends { score: number; tutorId: string }>(a: T, b: T): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.tutorId < b.tutorId ? -1 : a.tutorId > b.tutorId ? 1 : 0;
}
