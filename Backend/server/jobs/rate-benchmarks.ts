/**
 * `rate_benchmarks` materialisation — §6.19, SEC-17, NFR-16.
 *
 * Median and interquartile range of the **normalised hourly** rate per
 * (subject, level, area, mode), so that "eight thousand a month for three days
 * a week" and "nine hundred an hour" become comparable numbers (§2.7).
 *
 * ── The suppression threshold ──────────────────────────────────────────────
 * A cell with fewer than four tutors is computed but **not published**
 * (SEC-17). With three, a published median lets an individual tutor's rate be
 * inferred by anyone who knows the other two — and rates are commercially
 * sensitive to the person setting them.
 *
 * `published` is decided here, by the job, and stored. Leaving it to the read
 * path would mean every future caller had to remember the rule; storing it
 * means the query filters on a column.
 */

import { and, eq } from 'drizzle-orm';

import { newId, nowIso } from '../../shared/db-values';
import type { TeachingMode } from '../../shared/rates';
import { rateBenchmarks } from '../db/schema/derived';
import { SEARCHABLE_PROFILE_STATUS, tutorProfiles, tutorRates } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';

/** Below this cohort, nothing is published (SEC-17, NFR-16). */
export const MIN_BENCHMARK_COHORT = 4;

/**
 * Linear-interpolation percentile, the same method every time.
 *
 * Determinism matters more than the choice of method: a benchmark that shifts
 * because the implementation rounded differently is not a benchmark.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return Math.round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

export interface BenchmarkCell {
  subjectId: string;
  levelId: string;
  areaId: string;
  mode: TeachingMode;
  medianHourly: number;
  p25Hourly: number;
  p75Hourly: number;
  cohortSize: number;
  verifiedCount: number;
  published: boolean;
}

/**
 * Pure. One rate per tutor per cell — the **cheapest** — so a tutor with five
 * rate rows does not pull the median five times.
 */
export function computeBenchmarks(
  rows: ReadonlyArray<{
    tutorId: string;
    subjectId: string | null;
    levelId: string | null;
    areaId: string;
    mode: TeachingMode;
    normalisedHourlyAmount: number;
    verified: boolean;
  }>,
): BenchmarkCell[] {
  const cells = new Map<
    string,
    {
      subjectId: string;
      levelId: string;
      areaId: string;
      mode: TeachingMode;
      byTutor: Map<string, number>;
      verifiedTutors: Set<string>;
    }
  >();

  for (const row of rows) {
    // A blanket rate has no subject or level and therefore belongs to no cell.
    if (!row.subjectId || !row.levelId) continue;

    const key = `${row.subjectId}|${row.levelId}|${row.areaId}|${row.mode}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        subjectId: row.subjectId,
        levelId: row.levelId,
        areaId: row.areaId,
        mode: row.mode,
        byTutor: new Map(),
        verifiedTutors: new Set(),
      };
      cells.set(key, cell);
    }

    const current = cell.byTutor.get(row.tutorId);
    if (current === undefined || row.normalisedHourlyAmount < current) {
      cell.byTutor.set(row.tutorId, row.normalisedHourlyAmount);
    }
    if (row.verified) cell.verifiedTutors.add(row.tutorId);
  }

  const out: BenchmarkCell[] = [];

  // Sorted by key, so two runs over the same data write identical rows.
  for (const key of [...cells.keys()].sort()) {
    const cell = cells.get(key)!;
    const amounts = [...cell.byTutor.values()].sort((a, b) => a - b);

    out.push({
      subjectId: cell.subjectId,
      levelId: cell.levelId,
      areaId: cell.areaId,
      mode: cell.mode,
      medianHourly: percentile(amounts, 0.5),
      p25Hourly: percentile(amounts, 0.25),
      p75Hourly: percentile(amounts, 0.75),
      cohortSize: amounts.length,
      verifiedCount: cell.verifiedTutors.size,
      published: amounts.length >= MIN_BENCHMARK_COHORT,
    });
  }

  return out;
}

export interface BenchmarkJobResult {
  cells: number;
  published: number;
  suppressed: number;
  tookMs: number;
}

export async function recomputeRateBenchmarks(db: Executor): Promise<BenchmarkJobResult> {
  const startedAt = performance.now();

  // Only approved tutors set the market a family is compared against.
  const rows = await db
    .select({
      tutorId: tutorRates.tutorId,
      subjectId: tutorRates.subjectId,
      levelId: tutorRates.levelId,
      mode: tutorRates.mode,
      normalisedHourlyAmount: tutorRates.normalisedHourlyAmount,
      willingAreasJson: tutorProfiles.willingAreasJson,
      cityId: tutorProfiles.cityId,
    })
    .from(tutorRates)
    .innerJoin(tutorProfiles, eq(tutorProfiles.id, tutorRates.tutorId))
    .where(eq(tutorProfiles.profileStatus, SEARCHABLE_PROFILE_STATUS));

  // A tutor's rate applies in every area they serve.
  const expanded = rows.flatMap((row) => {
    const areas = JSON.parse(row.willingAreasJson) as string[];
    return areas.map((areaId) => ({
      tutorId: row.tutorId,
      subjectId: row.subjectId,
      levelId: row.levelId,
      areaId,
      mode: row.mode as TeachingMode,
      normalisedHourlyAmount: row.normalisedHourlyAmount,
      verified: true,
    }));
  });

  const cells = computeBenchmarks(expanded);

  let published = 0;
  for (const cell of cells) {
    if (cell.published) published += 1;

    const values = {
      medianHourly: cell.medianHourly,
      p25Hourly: cell.p25Hourly,
      p75Hourly: cell.p75Hourly,
      cohortSize: cell.cohortSize,
      verifiedCount: cell.verifiedCount,
      published: cell.published ? 1 : 0,
      computedAt: nowIso(),
    };

    const existing = await db
      .select({ id: rateBenchmarks.id })
      .from(rateBenchmarks)
      .where(
        and(
          eq(rateBenchmarks.subjectId, cell.subjectId),
          eq(rateBenchmarks.levelId, cell.levelId),
          eq(rateBenchmarks.areaId, cell.areaId),
          eq(rateBenchmarks.mode, cell.mode),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db.update(rateBenchmarks).set(values).where(eq(rateBenchmarks.id, existing[0].id));
    } else {
      await db.insert(rateBenchmarks).values({
        id: newId(),
        subjectId: cell.subjectId,
        levelId: cell.levelId,
        areaId: cell.areaId,
        mode: cell.mode,
        ...values,
      });
    }
  }

  return {
    cells: cells.length,
    published,
    suppressed: cells.length - published,
    tookMs: Math.round(performance.now() - startedAt),
  };
}
