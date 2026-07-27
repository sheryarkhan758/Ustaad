/**
 * The public tutor profile read — §6.4, §6.17, §6.21, §6.22.
 *
 * This is the anonymous, unauthenticated view of a tutor: what a family sees
 * before they have an account. It is a **read of already-materialised data**
 * — reliability comes from `tutor_reliability`, the rate comparison from
 * `rate_benchmarks`, both written by jobs. Nothing here computes a statistic
 * (§2.8).
 *
 * ── Why the slug lookup stays in `search.ts` ───────────────────────────────
 * `search.visibility.test.ts` enforces that only `server/repositories/search.ts`
 * selects from `tutor_profiles` for a public surface, so that "did this query
 * filter on approval?" is answerable by reading one file. This module honours
 * that: it resolves the tutor through `findSearchableTutorBySlug` and then
 * gathers the satellite tables keyed on the id it was given. An unapproved
 * tutor never gets past the first call, so nothing below can leak one
 * (FR-6.3).
 *
 * ── What is deliberately not returned ──────────────────────────────────────
 * No CNIC, no document path, no email, no address, and no `verifiedScore` —
 * the rubric figure behind a competency verdict is internal (FR-11.5). A
 * profile carries the tutor's city and the areas she will travel to, which is
 * the finest location granularity this product has (§4.2, SEC-3).
 */

import { and, eq, inArray } from 'drizzle-orm';

import { fromDbBool, fromDbJsonArray } from '../../shared/db-values';
import { rateBenchmarks, tutorReliability } from '../db/schema/derived';
import { subjects, levels, boards, topics } from '../db/schema/reference';
import { users } from '../db/schema/identity';
import {
  tutorAvailability,
  tutorRates,
  tutorSafetyConstraints,
  tutorSubjectClaims,
} from '../db/schema/tutor';
import type { TeachingMode } from '../../shared/rates';
import type { Executor } from './_base';
import { findSearchableTutorBySlug } from './search';
import type { TutorProfileRecord } from './tutors';

export interface PublicRate {
  id: string;
  subjectId: string | null;
  levelId: string | null;
  rateType: string;
  mode: TeachingMode;
  /** Paisa, as the tutor stated it. */
  amount: number;
  sessionsPerWeek: number | null;
  minutesPerSession: number | null;
  groupSizeMax: number | null;
  perHeadAmount: number | null;
  negotiable: boolean;
  travelCharge: number;
  /** Paisa per hour per student. Materialised on write — never computed here. */
  normalisedHourlyAmount: number;
}

export interface PublicClaim {
  id: string;
  subjectId: string;
  subjectName: string | null;
  levelId: string;
  levelName: string | null;
  boardId: string;
  boardName: string | null;
  topicNames: string[];
  /** `asserted` until an assessment passed. Never rendered as "verified". */
  claimStatus: string;
  verifiedAt: string | null;
  expiresOn: string | null;
}

export interface PublicReliability {
  /** The denominator, after the SEC-21 exclusion. */
  completedSessions: number;
  confirmationRate: number | null;
  onTimeRate: number | null;
  completionRate: number | null;
  /**
   * How many declines were excluded because she made them under a safety
   * constraint she had declared (SEC-21). Published so the exclusion is a
   * stated property rather than an invisible adjustment.
   */
  safetyDeclinesExcluded: number;
}

/**
 * The conditions she has declared — SEC-19, FR-29.10, FR-29.14.
 *
 * Published deliberately. A family that learns at submission time that this
 * tutor requires a guardian present has been made to fill in a form for
 * nothing, and a tutor who has to explain her conditions in a message each
 * time is doing work the platform should have done. Both sides see the same
 * text.
 *
 * These are **system-enforced**, not preferences: `createBookingRequest`
 * refuses a request that violates one, and a decline she makes under one is
 * excluded from her confirmation rate (SEC-21).
 */
export interface PublicSafetyConstraints {
  femaleStudentsOnly: boolean;
  guardianPresenceRequired: boolean;
  /** Areas she will not travel to. Named by the client from reference data. */
  restrictedAreaIds: string[];
}

export interface PublicTutorProfile {
  tutor: TutorProfileRecord & { displayName: string };
  rates: PublicRate[];
  claims: PublicClaim[];
  availability: {
    weekday: number;
    startTime: string;
    endTime: string;
    mode: TeachingMode;
    areaId: string | null;
  }[];
  reliability: PublicReliability | null;
  safety: PublicSafetyConstraints;
  /** Paisa. The cheapest normalised hourly rate she offers. */
  normalisedHourly: number | null;
  /** Paisa. The published local median, or null below the SEC-17 cohort of 4. */
  benchmarkMedian: number | null;
}

/**
 * Look a tutor up by slug and gather her public profile.
 *
 * Returns `null` for an unknown slug **and** for a tutor who is not approved —
 * the two are indistinguishable to the caller by design. A 404 that meant
 * "exists but not approved" would tell an anonymous visitor that a named
 * person had applied and been turned down.
 */
export async function loadPublicTutorProfile(
  db: Executor,
  slug: string,
): Promise<PublicTutorProfile | null> {
  const tutor = await findSearchableTutorBySlug(db, slug);
  if (!tutor) return null;

  const [account] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, tutor.userId))
    .limit(1);

  const rateRows = await db.select().from(tutorRates).where(eq(tutorRates.tutorId, tutor.id));

  const claimRows = await db
    .select()
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.tutorId, tutor.id));

  const availabilityRows = await db
    .select()
    .from(tutorAvailability)
    .where(eq(tutorAvailability.tutorId, tutor.id));

  const [reliabilityRow] = await db
    .select()
    .from(tutorReliability)
    .where(eq(tutorReliability.tutorId, tutor.id))
    .limit(1);

  const [safetyRow] = await db
    .select()
    .from(tutorSafetyConstraints)
    .where(eq(tutorSafetyConstraints.tutorId, tutor.id))
    .limit(1);

  /* --- Reference names, one bounded lookup per dimension ----------------- */

  const subjectIds = [...new Set(claimRows.map((c) => c.subjectId))];
  const levelIds = [...new Set(claimRows.map((c) => c.levelId))];
  const boardIds = [...new Set(claimRows.map((c) => c.boardId))];
  const topicIds = [
    ...new Set(claimRows.flatMap((c) => fromDbJsonArray(c.topicIdsJson))),
  ];

  const subjectRows = subjectIds.length
    ? await db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(inArray(subjects.id, subjectIds))
    : [];
  const levelRows = levelIds.length
    ? await db
        .select({ id: levels.id, name: levels.name })
        .from(levels)
        .where(inArray(levels.id, levelIds))
    : [];
  const boardRows = boardIds.length
    ? await db
        .select({ id: boards.id, name: boards.name })
        .from(boards)
        .where(inArray(boards.id, boardIds))
    : [];
  const topicRows = topicIds.length
    ? await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(inArray(topics.id, topicIds))
    : [];

  const nameOf = (rows: { id: string; name: string }[], id: string) =>
    rows.find((r) => r.id === id)?.name ?? null;

  /* --- The rate comparison ---------------------------------------------- */

  const normalisedHourly = rateRows.length
    ? Math.min(...rateRows.map((r) => r.normalisedHourlyAmount))
    : null;

  /*
   * The benchmark cell, for the rate she is cheapest on.
   *
   * A cell is keyed on (subject, level, area, mode), so a blanket rate — no
   * subject, no level — has no cell to compare against and the panel is
   * correctly absent rather than compared against the wrong cohort. `published`
   * is the SEC-17 suppression, decided once by the job; a `null` here is that
   * threshold working, not missing data.
   */
  const cheapest = rateRows.length
    ? rateRows.reduce((low, r) => (r.normalisedHourlyAmount < low.normalisedHourlyAmount ? r : low))
    : null;

  let benchmarkMedian: number | null = null;
  const benchmarkArea = tutor.willingAreaIds[0] ?? null;
  if (cheapest?.subjectId && cheapest.levelId && benchmarkArea) {
    const [benchmark] = await db
      .select({ medianHourly: rateBenchmarks.medianHourly })
      .from(rateBenchmarks)
      .where(
        and(
          eq(rateBenchmarks.subjectId, cheapest.subjectId),
          eq(rateBenchmarks.levelId, cheapest.levelId),
          eq(rateBenchmarks.areaId, benchmarkArea),
          eq(rateBenchmarks.mode, cheapest.mode),
          eq(rateBenchmarks.published, 1),
        ),
      )
      .limit(1);
    benchmarkMedian = benchmark?.medianHourly ?? null;
  }

  return {
    tutor: { ...tutor, displayName: account?.displayName ?? '' },

    rates: rateRows.map((r) => ({
      id: r.id,
      subjectId: r.subjectId,
      levelId: r.levelId,
      rateType: r.rateType,
      mode: r.mode,
      amount: r.amount,
      sessionsPerWeek: r.sessionsPerWeek,
      minutesPerSession: r.minutesPerSession,
      groupSizeMax: r.groupSizeMax,
      perHeadAmount: r.perHeadAmount,
      negotiable: fromDbBool(r.negotiable),
      travelCharge: r.travelCharge,
      normalisedHourlyAmount: r.normalisedHourlyAmount,
    })),

    claims: claimRows.map((c) => ({
      id: c.id,
      subjectId: c.subjectId,
      subjectName: nameOf(subjectRows, c.subjectId),
      levelId: c.levelId,
      levelName: nameOf(levelRows, c.levelId),
      boardId: c.boardId,
      boardName: nameOf(boardRows, c.boardId),
      topicNames: fromDbJsonArray(c.topicIdsJson)
        .map((id) => nameOf(topicRows, id))
        .filter((name): name is string => name !== null),
      // Carried through unchanged. `asserted` must never be presented as a
      // verification — the client renders the two differently (§2.5).
      claimStatus: c.claimStatus,
      verifiedAt: c.verifiedAt,
      expiresOn: c.expiresOn,
      // `verifiedScore` is deliberately absent — FR-11.5's rubric figure is
      // internal to the assessment, not a public number.
    })),

    availability: availabilityRows.map((a) => ({
      weekday: a.weekday,
      startTime: a.startTime,
      endTime: a.endTime,
      mode: a.mode,
      areaId: a.areaId,
    })),

    reliability: reliabilityRow
      ? {
          completedSessions: reliabilityRow.completedCount,
          confirmationRate: reliabilityRow.confirmationRate,
          onTimeRate: reliabilityRow.onTimeRate,
          completionRate: reliabilityRow.completionRate,
          safetyDeclinesExcluded: reliabilityRow.safetyDeclinesExcluded,
        }
      : null,

    /*
     * Absent means none declared, which is different from "unknown" and is
     * why this is never null: a booking form that could not tell the two
     * apart would have to ask for an acknowledgement nobody needs.
     */
    safety: {
      femaleStudentsOnly: safetyRow ? fromDbBool(safetyRow.femaleStudentsOnly) : false,
      guardianPresenceRequired: safetyRow ? fromDbBool(safetyRow.guardianPresenceRequired) : false,
      restrictedAreaIds: safetyRow ? fromDbJsonArray(safetyRow.restrictedAreaIdsJson) : [],
    },

    normalisedHourly,
    benchmarkMedian,
  };
}
