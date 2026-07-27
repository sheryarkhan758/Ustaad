/**
 * Unmet demand — §6.24, FR-24.1 to FR-24.7.
 *
 * A search that found nobody, or an intake that could not work out what the
 * child needed, is the platform's failure. It is also the only honest signal
 * about what this market wants and cannot get. A female tutor who learns that
 * eleven families in her district looked for a female Mathematics tutor last
 * month has information she can act on and can obtain nowhere else.
 *
 * ── The property this file exists to protect ────────────────────────────────
 *
 * **A record on this board must never be traceable to the family that produced
 * it** (FR-24.2). That is enforced in three places, and it needs all three:
 *
 *  1. **The table has no identity column.** Not a user id, not a student
 *     profile id, not a contact field. `unmet_demand` cannot leak a requester
 *     because it never receives one. That is the real defence; the other two
 *     exist because a count can identify someone even when a row cannot.
 *
 *  2. **Cohorts below three are suppressed** (FR-24.6). "One family in Clifton
 *     wanted A-Level Further Mathematics" is a description of one household.
 *
 *  3. **Nothing in a response varies with time or with the caller.** No
 *     timestamps, no "most recent", no caller-chosen window. A board that let
 *     you ask for 29 days and then 30 would hand you the single record in the
 *     difference, and the suppression threshold would have bought nothing.
 *     `DEMAND_WINDOW_DAYS` is a constant for that reason and must stay one.
 *
 * Budget is banded on the way in, so the board holds a band and not the figure
 * a family typed — a number specific enough to match back against a booking.
 */

import { z } from 'zod';

import { GENDER_PREFERENCES, type GenderPreference } from './search';

/** FR-24.6, and CLAUDE.md §2.8. Enforced in code, never in the interface. */
export const DEMAND_SUPPRESSION_THRESHOLD = 3;

/**
 * FR-24.3. **A constant, not a parameter.**
 *
 * Two overlapping windows differ by the records between them. Letting a caller
 * choose the window turns a suppressed board into a queryable one, so this is
 * not configurable and must not become configurable.
 */
export const DEMAND_WINDOW_DAYS = 30;

/* -------------------------------------------------------------------------
 * Budget bands
 * ---------------------------------------------------------------------- */

/**
 * Paisa per hour, normalised. Upper bounds, ascending; `null` is the open top
 * band. Chosen to sit around the real spread of home-tuition rates in urban
 * Pakistan rather than at round numbers that would split the population oddly.
 */
export const BUDGET_BANDS = [
  { id: 'under-500', label: 'Under Rs 500/hr', maxPaisa: 50_000 },
  { id: '500-1000', label: 'Rs 500–1,000/hr', maxPaisa: 100_000 },
  { id: '1000-2000', label: 'Rs 1,000–2,000/hr', maxPaisa: 200_000 },
  { id: '2000-plus', label: 'Rs 2,000/hr and above', maxPaisa: null },
] as const;

export type BudgetBandId = (typeof BUDGET_BANDS)[number]['id'];

/**
 * Round a stated ceiling to the band above it.
 *
 * Applied **on write**, so the exact figure never reaches the table. Doing it
 * on read would leave the precise number sitting in a column, one careless
 * `SELECT *` away from the board.
 */
export function toBudgetBand(paisa: number | null): BudgetBandId | null {
  if (paisa === null) return null;
  for (const band of BUDGET_BANDS) {
    if (band.maxPaisa === null || paisa <= band.maxPaisa) return band.id;
  }
  return '2000-plus';
}

export function budgetBandLabel(id: BudgetBandId | null): string {
  return BUDGET_BANDS.find((b) => b.id === id)?.label ?? 'No ceiling stated';
}

/**
 * The paisa value stored in `unmet_demand.budget_max`.
 *
 * The band's upper bound, or the top band's floor. A number, because the column
 * is `paisa` and stays comparable — but a number that is one of four, so it
 * carries a band and not a household.
 */
export function bandToStoredPaisa(id: BudgetBandId | null): number | null {
  if (id === null) return null;
  const band = BUDGET_BANDS.find((b) => b.id === id);
  return band?.maxPaisa ?? 200_001;
}

export function storedPaisaToBand(paisa: number | null): BudgetBandId | null {
  return paisa === null ? null : toBudgetBand(paisa);
}

/* -------------------------------------------------------------------------
 * Cohorts
 * ---------------------------------------------------------------------- */

export const UNMET_DEMAND_REASONS = ['no_matches', 'insufficient_information'] as const;
export type UnmetDemandReason = (typeof UNMET_DEMAND_REASONS)[number];

/**
 * What makes two records "the same kind of demand".
 *
 * Note the absence of a topic. Topics are reported separately and get their own
 * suppression pass, because a topic can be far more identifying than a subject:
 * "Organic Chemistry, Clifton" narrows a city to a handful of households in a
 * way "Chemistry, Clifton" does not.
 */
export interface DemandCohortKey {
  subjectId: string;
  levelId: string | null;
  boardId: string | null;
  areaId: string | null;
  genderPreference: GenderPreference;
}

export function cohortKeyOf(key: DemandCohortKey): string {
  return [
    key.subjectId,
    key.levelId ?? '-',
    key.boardId ?? '-',
    key.areaId ?? '-',
    key.genderPreference,
  ].join('|');
}

export interface DemandCohort extends DemandCohortKey {
  cohortKey: string;
  /** Records in the trailing window. Never below the threshold. */
  count: number;
  /**
   * Topics named by at least `DEMAND_SUPPRESSION_THRESHOLD` records in this
   * cohort, with their counts. Topics below it are omitted entirely — not
   * reported as "other", which would let the remainder be computed.
   */
  topics: { topicId: string; count: number }[];
  /** Band ids present in the cohort, each held by at least the threshold. */
  budgetBands: BudgetBandId[];
  reasons: { reason: UnmetDemandReason; count: number }[];
}

export interface DemandBoard {
  windowDays: number;
  cohorts: DemandCohort[];
  /**
   * How many records the window held in total, **before** suppression.
   *
   * Safe to publish and useful: it is a single number over every cohort, so it
   * cannot isolate one. Publishing per-cohort suppressed counts would not be.
   */
  totalRecordsInWindow: number;
  /** Cohorts that existed but fell below the threshold. A count, not a list. */
  suppressedCohortCount: number;
}

/**
 * Drop everything the threshold does not clear.
 *
 * Pure, so the suppression rule is testable without a database and cannot be
 * quietly bypassed by a query that forgets to call it.
 */
export function suppressSmallCohorts(
  cohorts: DemandCohort[],
  threshold: number = DEMAND_SUPPRESSION_THRESHOLD,
): { kept: DemandCohort[]; suppressedCount: number } {
  const kept = cohorts
    .filter((c) => c.count >= threshold)
    .map((c) => ({
      ...c,
      topics: c.topics.filter((t) => t.count >= threshold).sort(
        (a, b) => b.count - a.count || a.topicId.localeCompare(b.topicId),
      ),
      reasons: [...c.reasons].sort((a, b) => a.reason.localeCompare(b.reason)),
    }))
    // Deterministic ordering (FR-24.7): by size, then by a stable key. Never by
    // recency, which would leak when the records arrived.
    .sort((a, b) => b.count - a.count || a.cohortKey.localeCompare(b.cohortKey));

  return { kept, suppressedCount: cohorts.length - kept.length };
}

export const demandBoardQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  levelId: z.string().min(1).optional(),
  genderPreference: z.enum(GENDER_PREFERENCES).optional(),
});

export type DemandBoardQuery = z.infer<typeof demandBoardQuerySchema>;
