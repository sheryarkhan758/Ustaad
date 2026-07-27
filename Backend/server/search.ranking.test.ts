/**
 * Search, ranking and the materialisation jobs — §6.7, §6.16, §6.17, §6.19.
 *
 * The headline test is `gender preference makes non-conforming tutors ABSENT`.
 * It asserts absence rather than ordering on purpose: a test that checked "the
 * female tutors come first" would pass on an implementation that ranked male
 * tutors last and still showed them, which is precisely the implementation
 * FR-16.3 and decision 8 forbid. §2.1 is why — in households where daughters
 * are not permitted to travel, a female tutor at home is not a preference to be
 * accommodated at the margins, it is the only arrangement under which any
 * tuition happens.
 */

import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../shared/db-values';
import { RANKING_TERMS, RANKING_WEIGHTS, WEIGHTS_SUM, rankTutor } from '../shared/ranking';
import { normaliseHourlyAmount } from '../shared/rates';
import { searchQuerySchema } from '../shared/search';
import { createApp } from './app';
import { bookings } from './db/schema/booking';
import { rateBenchmarks, tutorReliability, tutorScores, tutorSearchSignals } from './db/schema/derived';
import { users } from './db/schema/identity';
import {
  SEARCHABLE_PROFILE_STATUS,
  tutorProfiles,
  tutorRates,
  tutorSubjectClaims,
} from './db/schema/tutor';
import { createSeededTestDb, type TestDb } from './db/test-db';
import { MIN_BENCHMARK_COHORT, computeBenchmarks, percentile } from './jobs/rate-benchmarks';
import { computeReliability } from './jobs/tutor-reliability';
import { runAllMaterialisationJobs } from './jobs/index';
import { searchTutors } from './repositories/search';

let db: TestDb;
let app: ReturnType<typeof createApp>;

interface TutorSpec {
  slug: string;
  gender: 'female' | 'male';
  areas?: string[];
  status?: string;
  monthlyPaisa?: number;
  topicId?: string;
  verified?: boolean;
}

async function makeTutor(spec: TutorSpec): Promise<string> {
  const userId = newId();
  const tutorId = newId();

  await db.insert(users).values({
    id: userId,
    email: `${spec.slug}@example.test`,
    passwordHash: 'not-a-real-hash',
    role: 'tutor',
    displayName: spec.slug,
    gender: spec.gender,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  await db.insert(tutorProfiles).values({
    id: tutorId,
    userId,
    gender: spec.gender,
    cityId: 'karachi',
    slug: spec.slug,
    profileStatus: (spec.status ?? SEARCHABLE_PROFILE_STATUS) as 'approved',
    teachesAtHome: 1,
    teachesOnline: 1,
    willingAreasJson: JSON.stringify(spec.areas ?? ['karachi-gulshan-e-iqbal']),
    createdAt: nowIso(),
  });

  const amount = spec.monthlyPaisa ?? 800_000;
  await db.insert(tutorRates).values({
    id: newId(),
    tutorId,
    subjectId: 'mathematics',
    levelId: 'matric',
    rateType: 'monthly',
    amount,
    currency: 'PKR',
    sessionsPerWeek: 3,
    minutesPerSession: 90,
    mode: 'home',
    negotiable: 0,
    travelCharge: 0,
    normalisedHourlyAmount: normaliseHourlyAmount({
      rateType: 'monthly',
      amount,
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    }),
    createdAt: nowIso(),
  });

  await db.insert(tutorSubjectClaims).values({
    id: newId(),
    tutorId,
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIdsJson: JSON.stringify([spec.topicId ?? 'math-matric-sindh-quadratic-equations']),
    claimStatus: spec.verified ? 'verified' : 'asserted',
    verifiedAt: spec.verified ? nowIso() : null,
    expiresOn: spec.verified ? '2027-12-31' : null,
    verifiedScore: spec.verified ? 90 : null,
    appealCount: 0,
    createdAt: nowIso(),
  });

  return tutorId;
}

const search = async (filters: Record<string, unknown> = {}) =>
  searchTutors(db, searchQuerySchema.parse(filters));

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

/* =========================================================================
 * 1. The hard exclusion
 * ====================================================================== */

describe('gender preference is a hard exclusion, not a ranking signal', () => {
  beforeEach(async () => {
    // The male tutor is deliberately the *stronger* candidate on every other
    // signal, so a boost-based implementation would still surface him.
    await makeTutor({ slug: 'female-weak', gender: 'female', verified: false, monthlyPaisa: 1_600_000 });
    await makeTutor({ slug: 'male-strong', gender: 'male', verified: true, monthlyPaisa: 400_000 });
    await runAllMaterialisationJobs(db);
  });

  it('makes every male tutor ABSENT under female_only', async () => {
    const response = await search({ genderPreference: 'female_only' });

    // Absence, not ordering.
    expect(response.results).toHaveLength(1);
    expect(response.results.every((r) => r.tutor.gender === 'female')).toBe(true);
    expect(response.results.map((r) => r.tutor.slug)).not.toContain('male-strong');
    expect(response.total).toBe(1);
  });

  it('makes every female tutor ABSENT under male_only', async () => {
    const response = await search({ genderPreference: 'male_only' });

    expect(response.results).toHaveLength(1);
    expect(response.results.every((r) => r.tutor.gender === 'male')).toBe(true);
    expect(response.results.map((r) => r.tutor.slug)).not.toContain('female-weak');
  });

  it('excludes even when the excluded tutor would have ranked first', async () => {
    const unfiltered = await search({});
    // Confirm the premise: the male tutor really is the stronger candidate.
    expect(unfiltered.results[0]!.tutor.slug).toBe('male-strong');

    const filtered = await search({ genderPreference: 'female_only' });
    expect(filtered.results.map((r) => r.tutor.slug)).toEqual(['female-weak']);
  });

  it('holds across every other filter combination', async () => {
    for (const extra of [
      {},
      { cityId: 'karachi' },
      { mode: 'home' },
      { mode: 'online' },
      { areaId: 'karachi-gulshan-e-iqbal' },
      { areaId: 'karachi-gulshan-e-iqbal', includeAdjacentAreas: true },
      { subjectId: 'mathematics', levelId: 'matric' },
      { topicIds: ['math-matric-sindh-quadratic-equations'] },
      { maxHourlyRate: 200_000 },
      { sort: 'rate_asc' },
      { sort: 'rate_desc' },
      { sort: 'reviews' },
      { limit: 50 },
    ]) {
      const response = await search({ ...extra, genderPreference: 'female_only' });
      expect(
        response.results.every((r) => r.tutor.gender === 'female'),
        JSON.stringify(extra),
      ).toBe(true);
    }
  });

  it('returns everyone under no_preference, and never pre-sets the filter', async () => {
    // FR-16.6: the default is no_preference and the system never changes it.
    const explicit = await search({ genderPreference: 'no_preference' });
    const defaulted = await search({});

    expect(explicit.results).toHaveLength(2);
    expect(defaulted.results).toHaveLength(2);
    expect(defaulted.appliedGenderPreference).toBe('no_preference');
  });

  it('reports the applied preference so a client need not filter', async () => {
    const response = await search({ genderPreference: 'female_only' });
    expect(response.appliedGenderPreference).toBe('female_only');
  });

  it('has no gender term in the ranking breakdown at all', async () => {
    const response = await search({});
    const breakdown = response.results[0]!.breakdown;

    // If gender were ever scored, this would be the place it appeared.
    expect(breakdown.terms.map((t) => t.term)).toEqual(RANKING_TERMS);
    expect(JSON.stringify(breakdown)).not.toMatch(/gender/i);
  });

  it('is applied over HTTP, not by the client', async () => {
    const res = await request(app).get('/api/search?genderPreference=female_only');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.appliedGenderPreference).toBe('female_only');
    // The excluded tutor is not in the payload in any form.
    expect(JSON.stringify(res.body)).not.toContain('male-strong');
  });
});

/* =========================================================================
 * 2. Determinism and the breakdown
 * ====================================================================== */

describe('ranking is deterministic and explainable', () => {
  beforeEach(async () => {
    await makeTutor({ slug: 'alpha', gender: 'female', verified: true });
    await makeTutor({ slug: 'beta', gender: 'female', verified: false });
    await makeTutor({ slug: 'gamma', gender: 'male', verified: true });
    await runAllMaterialisationJobs(db);
  });

  it('returns identical results and scores across repeated calls', async () => {
    const runs = await Promise.all([search({}), search({}), search({}), search({})]);
    const shape = runs.map((r) =>
      r.results.map((x) => `${x.tutor.slug}:${x.score}`).join('|'),
    );

    expect(new Set(shape).size).toBe(1);
  });

  it('breaks ties on tutor id, so paging cannot repeat or skip', async () => {
    // Two identical tutors: without a tiebreaker their order is whatever the
    // sort happened to produce, and page 2 could repeat one from page 1.
    const a = await search({ limit: 2, offset: 0 });
    const b = await search({ limit: 2, offset: 2 });

    const ids = [...a.results, ...b.results].map((r) => r.tutor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries a full breakdown for every result', async () => {
    const response = await search({});

    for (const result of response.results) {
      const { breakdown } = result;
      expect(breakdown.terms).toHaveLength(RANKING_TERMS.length);
      expect(breakdown.algorithmVersion).toBe('deterministic-v1');
      expect(breakdown.weights).toEqual(RANKING_WEIGHTS);

      // The narration component is handed this and may introduce no figure
      // absent from it (FR-22.4), so it must reconstruct the score exactly.
      const summed = breakdown.terms.reduce((total, t) => total + t.contribution, 0);
      expect(Math.abs(summed - breakdown.score)).toBeLessThan(0.001);

      for (const term of breakdown.terms) {
        expect(term.value).toBeGreaterThanOrEqual(0);
        expect(term.value).toBeLessThanOrEqual(1);
        expect(term.note.length).toBeGreaterThan(0);
        expect(term.inputs).toBeDefined();
      }
    }
  });

  it('has weights that sum to one', () => {
    expect(WEIGHTS_SUM).toBeCloseTo(1, 10);
  });

  it('makes no AI call and reads no unmaterialised statistic', async () => {
    // The proof is structural: with the materialised tables emptied, search
    // still answers — it simply scores everything neutrally. Anything that
    // computed a statistic inline would produce different numbers.
    await db.delete(tutorScores);
    await db.delete(tutorSearchSignals);
    await db.delete(tutorReliability);
    await db.delete(rateBenchmarks);

    const response = await search({});
    expect(response.results.length).toBeGreaterThan(0);

    for (const result of response.results) {
      const competency = result.breakdown.terms.find((t) => t.term === 'competency')!;
      const reviews = result.breakdown.terms.find((t) => t.term === 'reviews')!;
      // Zero, because the materialised source is gone — not recomputed.
      expect(competency.value).toBe(0);
      expect(reviews.value).toBe(0);
    }
  });

  it('scores a verified tutor above an unverified one, all else equal', async () => {
    const response = await search({ topicIds: ['math-matric-sindh-quadratic-equations'] });
    const alpha = response.results.find((r) => r.tutor.slug === 'alpha')!;
    const beta = response.results.find((r) => r.tutor.slug === 'beta')!;

    expect(alpha.score).toBeGreaterThan(beta.score);
  });

  it('is pure — the same inputs give the same score with no clock read', () => {
    const inputs = {
      artefactsCheckedCount: 2,
      competencyScore: 0.8,
      competencyIsTopicSpecific: true,
      reviewScore: 0.7,
      weightedReviewCount: 12,
      confirmationRate: 0.9,
      onTimeRate: 0.95,
      completionRate: 0.88,
      cancellationRate: 0.05,
      travelMinutes: 15,
      normalisedHourly: 41_026,
      benchmarkMedian: 50_000,
      recencyScore: 0.6,
    };

    const first = rankTutor(inputs);
    const second = rankTutor(inputs);
    expect(first).toEqual(second);
  });
});

/* =========================================================================
 * 3. The materialisation jobs
 * ====================================================================== */

describe('tutor_reliability excludes safety declines (SEC-21)', () => {
  it('removes a safety decline from the denominator entirely', () => {
    const withSafetyDecline = computeReliability('t1', [
      { status: 'completed', declineUnderSafetyConstraint: 0, requestedAt: nowIso(), respondedAt: nowIso(), slotStart: null, completedAt: nowIso() },
      { status: 'declined', declineUnderSafetyConstraint: 1, requestedAt: nowIso(), respondedAt: nowIso(), slotStart: null, completedAt: null },
    ]);

    // One request, one confirmation. The safety decline is not a decline and
    // not a request — holding to her own conditions costs her nothing.
    expect(withSafetyDecline.confirmationRate).toBe(1);
    expect(withSafetyDecline.bookingBasis).toBe(1);
    expect(withSafetyDecline.safetyDeclinesExcluded).toBe(1);
  });

  it('still counts an ordinary decline', () => {
    const ordinary = computeReliability('t1', [
      { status: 'completed', declineUnderSafetyConstraint: 0, requestedAt: nowIso(), respondedAt: nowIso(), slotStart: null, completedAt: nowIso() },
      { status: 'declined', declineUnderSafetyConstraint: 0, requestedAt: nowIso(), respondedAt: nowIso(), slotStart: null, completedAt: null },
    ]);

    expect(ordinary.confirmationRate).toBe(0.5);
    expect(ordinary.bookingBasis).toBe(2);
    expect(ordinary.safetyDeclinesExcluded).toBe(0);
  });

  it('stores the exclusion count so the published rate can be audited', async () => {
    const tutorId = await makeTutor({ slug: 'reliable', gender: 'female' });
    const parentId = newId();
    await db.insert(users).values({
      id: parentId,
      email: 'p@example.test',
      passwordHash: 'x',
      role: 'parent',
      displayName: 'P',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    const studentId = newId();
    await db.insert(await import('./db/schema/identity').then((m) => m.studentProfiles)).values({
      id: studentId,
      parentUserId: parentId,
      name: 'S',
      createdAt: nowIso(),
    });

    for (const [status, safety] of [
      ['completed', 0],
      ['declined', 1],
      ['declined', 1],
    ] as const) {
      await db.insert(bookings).values({
        id: newId(),
        tutorId,
        studentProfileId: studentId,
        requestedByUserId: parentId,
        engagementType: 'monthly',
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        topicIdsJson: '[]',
        mode: 'home',
        status,
        declineUnderSafetyConstraint: safety,
        requestedAt: nowIso(),
        createdAt: nowIso(),
      });
    }

    await runAllMaterialisationJobs(db);

    const row = (
      await db.select().from(tutorReliability).where(eq(tutorReliability.tutorId, tutorId))
    )[0]!;

    expect(row.safetyDeclinesExcluded).toBe(2);
    expect(row.bookingBasis).toBe(1);
    expect(row.confirmationRate).toBe(1);
  });
});

describe('rate_benchmarks suppress small cohorts (SEC-17)', () => {
  it('publishes nothing below a cohort of four', () => {
    const rows = Array.from({ length: MIN_BENCHMARK_COHORT - 1 }, (_, i) => ({
      tutorId: `t${i}`,
      subjectId: 'mathematics',
      levelId: 'matric',
      areaId: 'karachi-clifton',
      mode: 'home' as const,
      normalisedHourlyAmount: 40_000 + i * 1_000,
      verified: true,
    }));

    const cells = computeBenchmarks(rows);
    expect(cells).toHaveLength(1);
    // Computed, but withheld: with three, the median lets an individual's rate
    // be inferred by anyone who knows the other two.
    expect(cells[0]!.cohortSize).toBe(3);
    expect(cells[0]!.published).toBe(false);
  });

  it('publishes at exactly four, with an interquartile range', () => {
    const rows = [40_000, 50_000, 60_000, 70_000].map((amount, i) => ({
      tutorId: `t${i}`,
      subjectId: 'mathematics',
      levelId: 'matric',
      areaId: 'karachi-clifton',
      mode: 'home' as const,
      normalisedHourlyAmount: amount,
      verified: true,
    }));

    const cell = computeBenchmarks(rows)[0]!;
    expect(cell.published).toBe(true);
    expect(cell.medianHourly).toBe(55_000);
    expect(cell.p25Hourly).toBeLessThan(cell.medianHourly);
    expect(cell.p75Hourly).toBeGreaterThan(cell.medianHourly);
  });

  it('counts one rate per tutor, so a tutor with five rows does not skew it', () => {
    const rows = [30_000, 90_000, 95_000, 99_000].map((amount) => ({
      tutorId: 'same-tutor',
      subjectId: 'mathematics',
      levelId: 'matric',
      areaId: 'karachi-clifton',
      mode: 'home' as const,
      normalisedHourlyAmount: amount,
      verified: true,
    }));

    const cell = computeBenchmarks(rows)[0]!;
    expect(cell.cohortSize).toBe(1);
    expect(cell.medianHourly).toBe(30_000);
  });

  it('computes percentiles the same way every time', () => {
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 0.5)).toBe(25);
    expect(percentile(sorted, 0.5)).toBe(percentile(sorted, 0.5));
  });

  it('never lets an unpublished benchmark become a ranking penalty', async () => {
    // One tutor in the cell, so no benchmark is published.
    await makeTutor({ slug: 'lonely', gender: 'female', areas: ['karachi-malir'] });
    await runAllMaterialisationJobs(db);

    const response = await search({
      subjectId: 'mathematics',
      levelId: 'matric',
      areaId: 'karachi-malir',
      mode: 'home',
    });

    const rate = response.results[0]!.breakdown.terms.find((t) => t.term === 'ratePosition')!;
    expect(response.results[0]!.benchmarkMedian).toBeNull();
    // Neutral, not zero. A suppressed cell is a privacy control, not a verdict.
    expect(rate.value).toBe(0.5);
  });
});

/* =========================================================================
 * 4. Filters
 * ====================================================================== */

describe('filters exclude rather than deprioritise', () => {
  beforeEach(async () => {
    await makeTutor({ slug: 'in-area', gender: 'female', areas: ['karachi-clifton'] });
    await makeTutor({ slug: 'adjacent', gender: 'female', areas: ['karachi-dha'] });
    await makeTutor({ slug: 'far-away', gender: 'female', areas: ['karachi-malir'] });
    await makeTutor({ slug: 'expensive', gender: 'female', monthlyPaisa: 4_000_000 });
    await runAllMaterialisationJobs(db);
  });

  it('excludes tutors outside the chosen area', async () => {
    const response = await search({ areaId: 'karachi-clifton' });
    expect(response.results.map((r) => r.tutor.slug)).toEqual(['in-area']);
  });

  it('includes adjacent areas only when asked, and scores proximity', async () => {
    const response = await search({ areaId: 'karachi-clifton', includeAdjacentAreas: true });
    const slugs = response.results.map((r) => r.tutor.slug);

    expect(slugs).toContain('in-area');
    expect(slugs).toContain('adjacent');
    expect(slugs).not.toContain('far-away');

    const exact = response.results.find((r) => r.tutor.slug === 'in-area')!;
    const near = response.results.find((r) => r.tutor.slug === 'adjacent')!;
    expect(exact.travelMinutes).toBe(0);
    expect(near.travelMinutes).toBeGreaterThan(0);
    expect(
      exact.breakdown.terms.find((t) => t.term === 'proximity')!.value,
    ).toBeGreaterThan(near.breakdown.terms.find((t) => t.term === 'proximity')!.value);
  });

  it('excludes tutors above a price ceiling', async () => {
    const response = await search({ maxHourlyRate: 100_000 });
    expect(response.results.map((r) => r.tutor.slug)).not.toContain('expensive');
  });

  it('excludes unapproved tutors whatever the filters', async () => {
    await makeTutor({ slug: 'not-approved', gender: 'female', status: 'pending_verification' });
    await runAllMaterialisationJobs(db);

    const response = await search({});
    expect(response.results.map((r) => r.tutor.slug)).not.toContain('not-approved');
  });

  it('reports how long it took, so NFR-1 is observable', async () => {
    const response = await search({});
    expect(typeof response.tookMs).toBe('number');
    expect(response.tookMs).toBeLessThan(500);
  });
});
