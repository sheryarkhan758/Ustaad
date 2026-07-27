/**
 * Unmet demand — §6.24.
 *
 * The platform's failed searches, reframed as supply intelligence.
 *
 * ── What this module will not do ────────────────────────────────────────────
 *
 * It will not store who asked (FR-24.2), it will not publish a cohort smaller
 * than three (FR-24.6), it will not put a timestamp in a response, and it will
 * not let a caller choose the window. The last of those is the least obvious
 * and the one most likely to be undone by a well-meaning later change: a board
 * you can query at 29 days and again at 30 hands you the records in between,
 * and a threshold of three protects nothing against a caller who can subtract.
 *
 * ── It is not AI ────────────────────────────────────────────────────────────
 *
 * FR-24.7. Counting is counting. There is no model here and there is nothing
 * for one to do — a tutor deciding whether to start offering A-Level Physics in
 * her district needs a number she can rely on, not a paragraph about one.
 */

import {
  DEMAND_WINDOW_DAYS,
  budgetBandLabel,
  suppressSmallCohorts,
  toBudgetBand,
  bandToStoredPaisa,
  type DemandBoard,
  type DemandBoardQuery,
  type UnmetDemandReason,
} from '../../shared/unmet-demand';
import type { GenderPreference } from '../../shared/search';
import {
  aggregateDemandCohorts,
  demandWindowStart,
  insertUnmetDemand,
} from '../repositories/groups';
import type { Executor } from '../repositories/_base';

export interface RecordDemandInput {
  subjectId: string;
  topicIds: string[];
  levelId?: string | null;
  boardId?: string | null;
  areaId?: string | null;
  genderPreference?: GenderPreference;
  /** Paisa, exactly as the family stated it. Banded here and then discarded. */
  budgetMaxPaisa?: number | null;
  reason: UnmetDemandReason;
}

/**
 * Log a failed search or an inconclusive intake — FR-24.1.
 *
 * Takes no user id, no student profile id and no session id, and there is
 * nowhere to put one if it did. The banding happens on this side of the write
 * so the exact figure a family typed never reaches a column: a stated ceiling
 * of Rs 6,350 an hour is close to a fingerprint, and Rs 500–1,000 is not.
 */
export async function recordUnmetDemand(
  db: Executor,
  input: RecordDemandInput,
): Promise<{ id: string }> {
  const band = toBudgetBand(input.budgetMaxPaisa ?? null);

  const id = await insertUnmetDemand(db, {
    subjectId: input.subjectId,
    // Deduplicated and sorted, so two records of the same demand look the same
    // and cannot be told apart by the order a client happened to send.
    topicIds: [...new Set(input.topicIds)].sort(),
    levelId: input.levelId ?? null,
    boardId: input.boardId ?? null,
    areaId: input.areaId ?? null,
    genderPreference: input.genderPreference ?? 'no_preference',
    bandedBudgetPaisa: bandToStoredPaisa(band),
    reason: input.reason,
  });

  return { id };
}

export interface DemandBoardView extends DemandBoard {
  cohorts: (DemandBoard['cohorts'][number] & { budgetBandLabels: string[] })[];
}

/**
 * The tutor-facing board — FR-24.3, FR-24.5, FR-24.6.
 *
 * Counts only. The filters narrow which cohorts are shown; they cannot split
 * one, because every field a caller may filter on is already part of the cohort
 * key. That is the whole reason the key is defined the way it is: a filter that
 * carved a cohort into pieces would produce sub-counts below the threshold and
 * the suppression would be bypassed by the query rather than by a bug.
 */
export async function readDemandBoard(
  db: Executor,
  query: DemandBoardQuery,
  now: Date = new Date(),
): Promise<DemandBoardView> {
  const { cohorts, totalRecordsInWindow } = await aggregateDemandCohorts(db, {
    since: demandWindowStart(now),
    filters: query,
  });

  const { kept, suppressedCount } = suppressSmallCohorts(cohorts);

  return {
    windowDays: DEMAND_WINDOW_DAYS,
    totalRecordsInWindow,
    suppressedCohortCount: suppressedCount,
    cohorts: kept.map((c) => ({
      ...c,
      budgetBandLabels: c.budgetBands.map((b) => budgetBandLabel(b)),
    })),
  };
}

export interface SupplyGap {
  areaId: string | null;
  subjectId: string;
  count: number;
  /** Cohorts inside this area and subject, already suppressed. */
  cohorts: DemandBoard['cohorts'];
}

/**
 * The administrator supply-gap view — FR-24.4.
 *
 * Rolled up by area and subject, which is coarser than the tutor board and so
 * has more mass per row. **The same suppression applies.** An administrator is
 * not a third party (§2.2), but that principle is about disclosure to someone
 * accountable — it is not a reason to publish a cohort of one, because there is
 * no administrative decision that a count of one supports and a count of three
 * does not.
 */
export async function readSupplyGaps(
  db: Executor,
  query: DemandBoardQuery = {},
  now: Date = new Date(),
): Promise<{ windowDays: number; gaps: SupplyGap[]; suppressedCohortCount: number }> {
  const { cohorts } = await aggregateDemandCohorts(db, {
    since: demandWindowStart(now),
    filters: query,
  });

  const { kept, suppressedCount } = suppressSmallCohorts(cohorts);

  const byArea = new Map<string, SupplyGap>();
  for (const cohort of kept) {
    const key = `${cohort.areaId ?? '-'}|${cohort.subjectId}`;
    const gap = byArea.get(key) ?? {
      areaId: cohort.areaId,
      subjectId: cohort.subjectId,
      count: 0,
      cohorts: [],
    };
    gap.count += cohort.count;
    gap.cohorts.push(cohort);
    byArea.set(key, gap);
  }

  return {
    windowDays: DEMAND_WINDOW_DAYS,
    suppressedCohortCount: suppressedCount,
    gaps: [...byArea.values()].sort(
      (a, b) =>
        b.count - a.count ||
        (a.areaId ?? '').localeCompare(b.areaId ?? '') ||
        a.subjectId.localeCompare(b.subjectId),
    ),
  };
}
