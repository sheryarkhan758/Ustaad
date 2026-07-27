/**
 * Tutor search — §6.7, §6.16, NFR-1.
 *
 * **Every query that can put a tutor in front of a family lives in this
 * module.** The structural test in `search.visibility.test.ts` fails if any
 * other module selects from `tutor_profiles` for a public surface.
 *
 * Two rules are enforced in the SQL predicate below, before a single row is
 * ranked, and both are absences rather than penalties:
 *
 *  1. **Only `approved` tutors exist here** (FR-6.3). Draft, submitted, under
 *     review and rejected are all invisible.
 *  2. **Gender preference is a hard exclusion** (FR-16.3, decision 8). A
 *     `female_only` search cannot return a male tutor, because the predicate
 *     never selected one. There is no scoring term for gender and no
 *     client-side filter — see `shared/ranking.ts`.
 *
 * ── The 500 ms budget (NFR-1) ──────────────────────────────────────────────
 * One indexed query, no aggregate, no AI call. Ranking is a weighted sum over
 * columns already materialised by `server/jobs/`, applied in TypeScript to rows
 * already in memory. Selecting a tutor's applicable rate row and comparing it
 * to a stored benchmark is a lookup; computing the benchmark is a statistic,
 * and that happens in a job (CLAUDE.md §2.8).
 */

import { and, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';

import { compareRanked, rankTutor, type RankingBreakdown } from '../../shared/ranking';
import type { SearchQuery } from '../../shared/search';
import { fromDbJsonArray } from '../../shared/db-values';
import { areaAdjacency } from '../db/schema/reference';
import { users } from '../db/schema/identity';
import { verificationRecords } from '../db/schema/verification';
import {
  rateBenchmarks,
  tutorReliability,
  tutorScores,
  tutorSearchSignals,
} from '../db/schema/derived';
import {
  SEARCHABLE_PROFILE_STATUS,
  tutorAvailability,
  tutorProfiles,
  tutorRates,
  tutorSafetyConstraints,
  tutorSubjectClaims,
} from '../db/schema/tutor';
import type { TutorGender } from '../db/schema/tutor';
import type { Executor } from './_base';
import { type TutorProfileRecord, toTutorDomain } from './tutors';

/** The condition every search must include (FR-6.3). */
export function searchableTutorCondition(): SQL {
  return eq(tutorProfiles.profileStatus, SEARCHABLE_PROFILE_STATUS);
}

/**
 * The gender a preference requires. `no_preference` requires nothing.
 *
 * Returning `null` rather than a permissive condition matters: the absence of a
 * filter and a filter that happens to match everyone are different, and only
 * one of them is what FR-16.6 asks for.
 */
const REQUIRED_GENDER: Record<string, TutorGender | null> = {
  female_only: 'female',
  male_only: 'male',
  no_preference: null,
};

/**
 * What a result card shows beyond the ranking — §6.7, FR-7.x.
 *
 * Loaded by `hydrateResults` over the **paged** results only, in four bounded
 * queries, so the cost is fixed by `limit` rather than by how many tutors
 * matched. Every figure is read from a column a job materialised; nothing here
 * is aggregated at request time (§2.8, NFR-1).
 */
export interface SearchResultDetail {
  displayName: string;
  bio: string | null;
  /** Area ids she will travel to. Named by the client from reference data. */
  willingAreaIds: string[];
  /** Which identity artefacts an administrator checked (FR-6.5). */
  verifiedArtefacts: string[];
  /** Topics that passed an assessment, with the date and expiry (FR-11.6). */
  competency: { topicId: string; verifiedAt: string | null; expiresOn: string | null }[];
  /** Materialised by `server/jobs/tutor-reliability.ts` (§6.17). */
  reliability: {
    completedSessions: number;
    confirmationRate: number | null;
    onTimeRate: number | null;
    completionRate: number | null;
  } | null;
  /** The engagement shapes she prices, derived from her rate rows (§6.30). */
  engagementTypes: string[];
}

export interface SearchResult {
  tutor: TutorProfileRecord;
  score: number;
  /**
   * The full arithmetic. Handed to the narration component (§6.22), which
   * explains it without recomputing anything and may introduce no figure that
   * is not in here (FR-22.4).
   */
  breakdown: RankingBreakdown;
  /** Paisa per hour, normalised, for the filters given. */
  normalisedHourly: number | null;
  /** Paisa. The published local median, or null below the SEC-17 cohort of 4. */
  benchmarkMedian: number | null;
  travelMinutes: number | null;
  /** Present on returned results; absent while ranking. */
  detail?: SearchResultDetail;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  /** Milliseconds spent in this call. Surfaced so NFR-1 is observable. */
  tookMs: number;
  /** Restated so a caller can see the exclusion was applied server-side. */
  appliedGenderPreference: SearchQuery['genderPreference'];
}

/**
 * Areas to accept: the chosen one, plus adjacent ones when asked (FR-7.7).
 *
 * Returns travel minutes per area so proximity can be scored without a second
 * lookup. `area_adjacency` is seeded reference data, not a computation.
 */
async function resolveAreaScope(
  db: Executor,
  query: SearchQuery,
): Promise<Map<string, number> | null> {
  if (!query.areaId) return null;

  const scope = new Map<string, number>([[query.areaId, 0]]);
  if (!query.includeAdjacentAreas) return scope;

  const neighbours = await db
    .select()
    .from(areaAdjacency)
    .where(eq(areaAdjacency.areaId, query.areaId));

  for (const edge of neighbours) scope.set(edge.adjacentAreaId, edge.travelMinutes);
  return scope;
}

/**
 * Run a search.
 *
 * Reads only materialised columns for every ranking input. The rows are
 * assembled by one query; the second and third queries are bounded lookups over
 * the candidate set, not per-row round trips.
 */
export async function searchTutors(
  db: Executor,
  query: SearchQuery,
): Promise<SearchResponse> {
  const startedAt = performance.now();

  /* --- 1. The predicate. Exclusions happen here, before any ranking. ----- */

  const conditions: SQL[] = [searchableTutorCondition()];

  // FR-16.3. A non-conforming tutor is never selected, so cannot be ranked,
  // returned, or recovered by a client that ignores the filter.
  const requiredGender = REQUIRED_GENDER[query.genderPreference] ?? null;
  if (requiredGender) conditions.push(eq(tutorProfiles.gender, requiredGender));

  if (query.cityId) conditions.push(eq(tutorProfiles.cityId, query.cityId));
  if (query.volunteerOnly) conditions.push(eq(tutorProfiles.volunteerFlag, 1));

  if (query.mode === 'home') conditions.push(eq(tutorProfiles.teachesAtHome, 1));
  if (query.mode === 'online') conditions.push(eq(tutorProfiles.teachesOnline, 1));
  if (query.mode === 'own_place') conditions.push(eq(tutorProfiles.teachesAtOwnPlace, 1));

  const candidates = await db
    .select({
      profile: tutorProfiles,
      signals: tutorSearchSignals,
      reliability: tutorReliability,
      safety: tutorSafetyConstraints,
    })
    .from(tutorProfiles)
    .leftJoin(tutorSearchSignals, eq(tutorSearchSignals.tutorId, tutorProfiles.id))
    .leftJoin(tutorReliability, eq(tutorReliability.tutorId, tutorProfiles.id))
    .leftJoin(tutorSafetyConstraints, eq(tutorSafetyConstraints.tutorId, tutorProfiles.id))
    .where(and(...conditions));

  if (candidates.length === 0) {
    return {
      results: [],
      total: 0,
      tookMs: Math.round(performance.now() - startedAt),
      appliedGenderPreference: query.genderPreference,
    };
  }

  const candidateIds = candidates.map((c) => c.profile.id);

  /* --- 2. Bounded lookups over the candidate set ------------------------- */

  // Per-topic competency, when a topic was asked for.
  const topicScores =
    query.topicIds && query.topicIds.length > 0
      ? await db
          .select()
          .from(tutorScores)
          .where(
            and(
              inArray(tutorScores.tutorId, candidateIds),
              inArray(tutorScores.topicId, query.topicIds),
            ),
          )
      : [];

  const bestTopicScore = new Map<string, { score: number; verified: boolean }>();
  for (const row of topicScores) {
    const current = bestTopicScore.get(row.tutorId);
    if (!current || row.compositeScore > current.score) {
      bestTopicScore.set(row.tutorId, {
        score: row.compositeScore,
        verified: row.competencyVerified === 1,
      });
    }
  }

  // Rates matching the curriculum filters.
  const rateConditions: SQL[] = [inArray(tutorRates.tutorId, candidateIds)];
  if (query.subjectId) {
    rateConditions.push(
      or(eq(tutorRates.subjectId, query.subjectId), isNull(tutorRates.subjectId))!,
    );
  }
  if (query.levelId) {
    rateConditions.push(or(eq(tutorRates.levelId, query.levelId), isNull(tutorRates.levelId))!);
  }
  if (query.mode) rateConditions.push(eq(tutorRates.mode, query.mode));
  if (query.maxHourlyRate) {
    rateConditions.push(lte(tutorRates.normalisedHourlyAmount, query.maxHourlyRate));
  }

  const rates = await db
    .select({
      tutorId: tutorRates.tutorId,
      normalisedHourlyAmount: tutorRates.normalisedHourlyAmount,
      rateType: tutorRates.rateType,
    })
    .from(tutorRates)
    .where(and(...rateConditions));

  const cheapestRate = new Map<string, number>();
  for (const rate of rates) {
    const current = cheapestRate.get(rate.tutorId);
    if (current === undefined || rate.normalisedHourlyAmount < current) {
      cheapestRate.set(rate.tutorId, rate.normalisedHourlyAmount);
    }
  }

  // Availability window.
  let availableTutorIds: Set<string> | null = null;
  if (query.availableWeekday !== undefined) {
    const slotConditions: SQL[] = [
      inArray(tutorAvailability.tutorId, candidateIds),
      eq(tutorAvailability.weekday, query.availableWeekday),
    ];
    // `HH:MM` text compares lexicographically in chronological order, so this
    // is an index range scan and not a date function (PORTABILITY.md rule 1).
    if (query.availableFrom) slotConditions.push(lte(tutorAvailability.startTime, query.availableFrom));
    if (query.availableTo) slotConditions.push(gte(tutorAvailability.endTime, query.availableTo));

    const slots = await db
      .select({ tutorId: tutorAvailability.tutorId })
      .from(tutorAvailability)
      .where(and(...slotConditions));
    availableTutorIds = new Set(slots.map((s) => s.tutorId));
  }

  // The published local benchmark for this cell (§6.19, SEC-17).
  const areaScope = await resolveAreaScope(db, query);
  let benchmarkMedian: number | null = null;
  if (query.subjectId && query.levelId && query.areaId && query.mode) {
    const rows = await db
      .select()
      .from(rateBenchmarks)
      .where(
        and(
          eq(rateBenchmarks.subjectId, query.subjectId),
          eq(rateBenchmarks.levelId, query.levelId),
          eq(rateBenchmarks.areaId, query.areaId),
          eq(rateBenchmarks.mode, query.mode),
          // Suppressed below a cohort of four, decided by the job (SEC-17).
          eq(rateBenchmarks.published, 1),
        ),
      )
      .limit(1);
    benchmarkMedian = rows[0]?.medianHourly ?? null;
  }

  /* --- 3. Rank. A weighted sum over materialised values, in memory. ------ */

  const results: SearchResult[] = [];

  for (const candidate of candidates) {
    const tutorId = candidate.profile.id;
    const signals = candidate.signals;

    if (availableTutorIds && !availableTutorIds.has(tutorId)) continue;

    const topic = bestTopicScore.get(tutorId);
    if (query.topicIds && query.topicIds.length > 0 && !topic) continue;
    if (query.verifiedOnly && !topic?.verified) continue;

    const normalisedHourly = cheapestRate.get(tutorId) ?? null;
    // A price ceiling excludes; it never merely deprioritises.
    if (query.maxHourlyRate !== undefined && normalisedHourly === null) continue;

    let travelMinutes: number | null = null;
    if (areaScope) {
      const served = JSON.parse(candidate.profile.willingAreasJson) as string[];
      for (const area of served) {
        const minutes = areaScope.get(area);
        if (minutes !== undefined && (travelMinutes === null || minutes < travelMinutes)) {
          travelMinutes = minutes;
        }
      }
      // An area filter excludes. `includeAdjacentAreas` widens which areas
      // count as a match; it does not turn the filter into a ranking nudge.
      if (travelMinutes === null) continue;
    }

    const breakdown = rankTutor({
      artefactsCheckedCount: signals?.artefactsCheckedCount ?? 0,
      competencyScore: topic?.score ?? signals?.overallScore ?? 0,
      competencyIsTopicSpecific: topic !== undefined,
      reviewScore: signals?.overallScore ?? 0,
      weightedReviewCount: signals?.weightedReviewCount ?? 0,
      confirmationRate: candidate.reliability?.confirmationRate ?? null,
      onTimeRate: candidate.reliability?.onTimeRate ?? null,
      completionRate: candidate.reliability?.completionRate ?? null,
      cancellationRate: candidate.reliability?.cancellationRate ?? null,
      travelMinutes,
      normalisedHourly,
      benchmarkMedian,
      recencyScore: signals?.recencyScore ?? 0,
    });

    results.push({
      tutor: toTutorDomain(candidate.profile),
      score: breakdown.score,
      breakdown,
      normalisedHourly,
      benchmarkMedian,
      travelMinutes,
    });
  }

  /* --- 4. Order and page ------------------------------------------------- */

  results.sort((a, b) => {
    switch (query.sort) {
      case 'rate_asc':
        return (a.normalisedHourly ?? Infinity) - (b.normalisedHourly ?? Infinity);
      case 'rate_desc':
        return (b.normalisedHourly ?? -1) - (a.normalisedHourly ?? -1);
      case 'reviews':
        return b.breakdown.terms[2]!.value - a.breakdown.terms[2]!.value;
      case 'response_time':
        return b.breakdown.terms[3]!.value - a.breakdown.terms[3]!.value;
      default:
        return compareRanked(
          { score: a.score, tutorId: a.tutor.id },
          { score: b.score, tutorId: b.tutor.id },
        );
    }
  });

  const page = results.slice(query.offset, query.offset + query.limit);

  /* --- 5. Hydrate the page, and only the page --------------------------- */

  const hydrated = await hydrateResults(db, page);

  return {
    results: hydrated,
    total: results.length,
    tookMs: Math.round(performance.now() - startedAt),
    appliedGenderPreference: query.genderPreference,
  };
}

/**
 * Load what a result card displays, for one page of results.
 *
 * ── Why this runs after paging, not before ────────────────────────────────
 * Ranking needs materialised **scores**; a card needs a name, a biography, a
 * verification summary and a reliability record. Loading the second set for
 * every candidate would mean five hundred tutors' worth of joins to render
 * twenty cards. Running it over `page` fixes the cost at `limit` regardless of
 * how many matched, which is what keeps the NFR-1 budget a property of the
 * query rather than of the dataset.
 *
 * Four queries, each an `inArray` over at most `limit` ids — never a lookup
 * per row.
 *
 * ── Nothing is computed here ──────────────────────────────────────────────
 * Reliability is read from `tutor_reliability`, written by a job. Verification
 * artefacts are read from the approved record an administrator signed. The
 * engagement types are the distinct `rate_type` values she actually priced.
 * The only arithmetic is `Math.max`, choosing the most recent of two dates
 * (§2.8).
 */
async function hydrateResults(db: Executor, page: SearchResult[]): Promise<SearchResult[]> {
  if (page.length === 0) return [];

  const tutorIds = page.map((result) => result.tutor.id);
  const userIds = page.map((result) => result.tutor.userId);

  const [accounts, records, claims, rateRows, reliabilityRows] = await Promise.all([
    db.select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds)),

    // Identity: the artefacts an administrator actually checked (FR-6.5).
    db.select({
      tutorId: verificationRecords.tutorId,
      artefactsCheckedJson: verificationRecords.artefactsCheckedJson,
      decidedAt: verificationRecords.decidedAt,
    })
      .from(verificationRecords)
      .where(
        and(
          inArray(verificationRecords.tutorId, tutorIds),
          eq(verificationRecords.track, 'identity'),
          eq(verificationRecords.decision, 'approved'),
        ),
      ),

    // Competency: per topic, never per subject (FR-11.6).
    db.select({
      tutorId: tutorSubjectClaims.tutorId,
      topicIdsJson: tutorSubjectClaims.topicIdsJson,
      verifiedAt: tutorSubjectClaims.verifiedAt,
      expiresOn: tutorSubjectClaims.expiresOn,
    })
      .from(tutorSubjectClaims)
      .where(
        and(
          inArray(tutorSubjectClaims.tutorId, tutorIds),
          eq(tutorSubjectClaims.claimStatus, 'verified'),
        ),
      ),

    db.select({ tutorId: tutorRates.tutorId, rateType: tutorRates.rateType })
      .from(tutorRates)
      .where(inArray(tutorRates.tutorId, tutorIds)),

    db.select().from(tutorReliability).where(inArray(tutorReliability.tutorId, tutorIds)),
  ]);

  const nameByUser = new Map(accounts.map((row) => [row.id, row.displayName]));

  // The most recent approval wins: an artefact list from an older record would
  // understate what has since been checked.
  const artefactsByTutor = new Map<string, { at: string; artefacts: string[] }>();
  for (const row of records) {
    const current = artefactsByTutor.get(row.tutorId);
    if (!current || row.decidedAt > current.at) {
      artefactsByTutor.set(row.tutorId, {
        at: row.decidedAt,
        artefacts: fromDbJsonArray(row.artefactsCheckedJson),
      });
    }
  }

  const competencyByTutor = new Map<string, SearchResultDetail['competency']>();
  for (const row of claims) {
    const list = competencyByTutor.get(row.tutorId) ?? [];
    for (const topicId of fromDbJsonArray(row.topicIdsJson)) {
      list.push({ topicId, verifiedAt: row.verifiedAt, expiresOn: row.expiresOn });
    }
    competencyByTutor.set(row.tutorId, list);
  }

  const engagementByTutor = new Map<string, Set<string>>();
  for (const row of rateRows) {
    const set = engagementByTutor.get(row.tutorId) ?? new Set<string>();
    set.add(row.rateType);
    engagementByTutor.set(row.tutorId, set);
  }

  const reliabilityByTutor = new Map(reliabilityRows.map((row) => [row.tutorId, row]));

  return page.map((result) => {
    const reliability = reliabilityByTutor.get(result.tutor.id);

    return {
      ...result,
      detail: {
        displayName: nameByUser.get(result.tutor.userId) ?? '',
        bio: result.tutor.bio,
        willingAreaIds: result.tutor.willingAreaIds,
        verifiedArtefacts: artefactsByTutor.get(result.tutor.id)?.artefacts ?? [],
        competency: competencyByTutor.get(result.tutor.id) ?? [],
        reliability: reliability
          ? {
              completedSessions: reliability.completedCount,
              confirmationRate: reliability.confirmationRate,
              onTimeRate: reliability.onTimeRate,
              completionRate: reliability.completionRate,
            }
          : null,
        engagementTypes: [...(engagementByTutor.get(result.tutor.id) ?? [])],
      },
    };
  });
}

/* -------------------------------------------------------------------------
 * Single-tutor reads, gated on the same predicate
 * ---------------------------------------------------------------------- */

export async function findSearchableTutorBySlug(
  db: Executor,
  slug: string,
): Promise<TutorProfileRecord | null> {
  const rows = await db
    .select()
    .from(tutorProfiles)
    .where(and(eq(tutorProfiles.slug, slug), searchableTutorCondition()))
    .limit(1);
  return rows[0] ? toTutorDomain(rows[0]) : null;
}

export async function findSearchableTutorsByIds(
  db: Executor,
  ids: string[],
): Promise<TutorProfileRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(tutorProfiles)
    .where(and(inArray(tutorProfiles.id, ids), searchableTutorCondition()));
  return rows.map(toTutorDomain);
}

export async function isTutorSearchable(db: Executor, tutorId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tutorProfiles.id })
    .from(tutorProfiles)
    .where(and(eq(tutorProfiles.id, tutorId), searchableTutorCondition()))
    .limit(1);
  return rows.length === 1;
}
