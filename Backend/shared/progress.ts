/**
 * The progress ledger's arithmetic — §6.12.
 *
 * Pure functions over already-fetched rows: no database, no clock, no AI. The
 * same notes in the same order always produce the same ledger, which is what
 * lets a parent be told *why* a topic is marked stagnant rather than being shown
 * a number and asked to trust it.
 *
 * Nothing here is a platform statistic. Every figure is scoped to one student
 * and computed from that student's own session notes — see the note on §2.8 in
 * `server/services/progress-ledger.ts`.
 */

import { z } from 'zod';

/** FR-12.1 — mastery is a one-to-five rating per topic. */
export const MASTERY_MIN = 1;
export const MASTERY_MAX = 5;

/**
 * FR-12.4 — "a topic shows three or more sessions with no increase in mastery".
 *
 * Three, not two: two flat sessions is a fortnight, which is ordinary. Three is
 * a pattern the parent should be told about while there is still time to change
 * something.
 */
export const STAGNATION_SESSIONS = 3;

export const masteryRatingSchema = z.number().int().min(MASTERY_MIN).max(MASTERY_MAX);

/** One rating of one topic, at one moment. */
export interface MasteryObservation {
  topicId: string;
  rating: number;
  /** ISO-8601 UTC. Fixed width, so string ordering is chronological (§2.1). */
  at: string;
  /** Which session it came from — the parent's route back to the note. */
  bookingId: string;
}

/** A topic's history, oldest first. */
export interface TopicMasterySeries {
  topicId: string;
  points: { at: string; rating: number; bookingId: string }[];
  firstRating: number;
  latestRating: number;
  /** `latest - first`. Negative is possible and is not hidden. */
  change: number;
  /** Highest rating ever recorded, which `latestRating` may sit below. */
  best: number;
  sessions: number;
  /**
   * Sessions recorded since mastery last went up. Equals `sessions` when it
   * never has.
   */
  sessionsSinceImprovement: number;
  /** FR-12.4. */
  stagnant: boolean;
}

/**
 * Build the per-topic series — FR-12.2's "mastery per topic over time".
 *
 * Observations are sorted by timestamp with the booking id as a tiebreaker, so
 * two notes written in the same millisecond still order deterministically
 * rather than by whatever the database returned.
 */
export function buildMasterySeries(observations: MasteryObservation[]): TopicMasterySeries[] {
  const byTopic = new Map<string, MasteryObservation[]>();
  for (const observation of observations) {
    const list = byTopic.get(observation.topicId);
    if (list) list.push(observation);
    else byTopic.set(observation.topicId, [observation]);
  }

  const series: TopicMasterySeries[] = [];
  for (const [topicId, raw] of byTopic) {
    const sorted = [...raw].sort(
      (a, b) => a.at.localeCompare(b.at) || a.bookingId.localeCompare(b.bookingId),
    );
    const ratings = sorted.map((o) => o.rating);
    const sessionsSinceImprovement = sessionsSinceLastIncrease(ratings);

    series.push({
      topicId,
      points: sorted.map((o) => ({ at: o.at, rating: o.rating, bookingId: o.bookingId })),
      firstRating: ratings[0]!,
      latestRating: ratings[ratings.length - 1]!,
      change: ratings[ratings.length - 1]! - ratings[0]!,
      best: Math.max(...ratings),
      sessions: ratings.length,
      sessionsSinceImprovement,
      stagnant: sessionsSinceImprovement >= STAGNATION_SESSIONS,
    });
  }

  return series.sort((a, b) => a.topicId.localeCompare(b.topicId));
}

/**
 * How many sessions have been recorded since mastery last went **up**.
 *
 * Counted from the last genuine increase rather than by looking for a run of
 * identical values, so a topic drifting 4 → 3 → 3 registers as three sessions
 * without improvement instead of two. A rating that falls is not progress, and
 * treating "unchanged" as the only stagnation signal would miss the case the
 * parent most needs to see.
 */
export function sessionsSinceLastIncrease(ratings: readonly number[]): number {
  if (ratings.length === 0) return 0;
  for (let i = ratings.length - 1; i > 0; i -= 1) {
    if (ratings[i]! > ratings[i - 1]!) return ratings.length - i;
  }
  return ratings.length;
}

/* -------------------------------------------------------------------------
 * FR-12.3 — the diagnostic gap map against actual coverage
 * ---------------------------------------------------------------------- */

/** One topic the intake agent identified as a gap (`shared/ai-contract.ts`). */
export interface DiagnosedGap {
  topicId: string;
  isRootGap: boolean;
  /** The agent's own hedge. Carried for provenance; never shown as a figure. */
  confidence: number;
  rationale: string;
}

export const GAP_COVERAGE_STATES = ['addressed', 'in_progress', 'not_addressed'] as const;
export type GapCoverageState = (typeof GAP_COVERAGE_STATES)[number];

export interface GapCoverage {
  topicId: string;
  isRootGap: boolean;
  rationale: string;
  state: GapCoverageState;
  /** Sessions in which this topic was covered. Zero when never taught. */
  sessions: number;
  latestRating: number | null;
  stagnant: boolean;
}

/**
 * Mastery at or above which a diagnosed gap counts as **addressed**.
 *
 * Four of five: "the student can do this without help". Three is the middle of
 * the scale and means the gap is being worked on, which is what
 * `in_progress` says. Setting the bar at three would let the ledger report a
 * gap closed while the student still needed support with it — and the ledger's
 * only value is that a parent can believe it.
 */
export const GAP_ADDRESSED_RATING = 4;

/**
 * FR-12.3 — "the original diagnostic gap map displayed alongside actual
 * coverage, showing which gaps have been addressed and which have not".
 *
 * A gap never taught is `not_addressed` with zero sessions, which is the row
 * that matters most: it is the one that says the plan and the teaching have
 * come apart.
 *
 * This function only classifies. It invents no gaps — a topic taught that was
 * never diagnosed is real teaching, but it is not part of *this* comparison,
 * and folding it in would quietly turn "gaps closed" into "topics covered".
 */
export function compareGapMapToCoverage(
  gaps: readonly DiagnosedGap[],
  series: readonly TopicMasterySeries[],
): GapCoverage[] {
  const byTopic = new Map(series.map((s) => [s.topicId, s]));

  return gaps
    .map((gap) => {
      const taught = byTopic.get(gap.topicId);
      if (!taught) {
        return {
          topicId: gap.topicId,
          isRootGap: gap.isRootGap,
          rationale: gap.rationale,
          state: 'not_addressed' as GapCoverageState,
          sessions: 0,
          latestRating: null,
          stagnant: false,
        };
      }

      const state: GapCoverageState =
        taught.latestRating >= GAP_ADDRESSED_RATING ? 'addressed' : 'in_progress';

      return {
        topicId: gap.topicId,
        isRootGap: gap.isRootGap,
        rationale: gap.rationale,
        state,
        sessions: taught.sessions,
        latestRating: taught.latestRating,
        stagnant: taught.stagnant,
      };
    })
    .sort(
      (a, b) =>
        // Root gaps first — they are the ones the rest depend on — then by id
        // so the order is stable across requests.
        Number(b.isRootGap) - Number(a.isRootGap) || a.topicId.localeCompare(b.topicId),
    );
}

/** The shape `diagnostics.gap_map_json` is written in by the intake agent. */
export function readGapsFromGapMap(gapMap: unknown): DiagnosedGap[] {
  const parsed = z
    .object({
      gaps: z
        .array(
          z.object({
            topicId: z.string().min(1),
            confidence: z.number().min(0).max(1).default(0),
            rationale: z.string().default(''),
            isRootGap: z.boolean().default(false),
          }),
        )
        .default([]),
    })
    .safeParse(gapMap);

  // A malformed stored gap map yields no comparison rather than an error. The
  // ledger's mastery half is still true and still worth showing; failing the
  // whole request over one unparseable column would take it away.
  return parsed.success ? parsed.data.gaps : [];
}
