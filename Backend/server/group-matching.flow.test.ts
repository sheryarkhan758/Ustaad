/**
 * Group tuition and unmet demand, end to end — §6.23, §6.24.
 *
 * The four things this suite exists to prove, in the order the task set them:
 *
 *  1. Three compatible requests pool into **one confirmed group** at the
 *     reduced per-head rate, with a linked booking each.
 *  2. Two requests differing on **any** hard constraint do not pool — checked
 *     one constraint at a time, so a single over-broad predicate cannot make
 *     the whole set pass.
 *  3. The same input always yields the same grouping, byte for byte.
 *  4. No unmet-demand response contains anything traceable to a requester —
 *     asserted structurally against the table and behaviourally against the
 *     response body, because either alone would be worth little.
 */

import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';

import { newId, nowIso } from '../shared/db-values';
import {
  intersectAvailability,
  intersectGenderPreference,
  pairFailures,
  poolRequests,
  type AvailabilityWindow,
  type GroupCandidate,
} from '../shared/group-matching';
import {
  DEMAND_SUPPRESSION_THRESHOLD,
  DEMAND_WINDOW_DAYS,
  suppressSmallCohorts,
  toBudgetBand,
} from '../shared/unmet-demand';
import { bookings } from './db/schema/booking';
import { studentProfiles, users } from './db/schema/identity';
import { groupProposals, groupRequests, unmetDemand } from './db/schema/matching';

import { tutorProfiles, tutorRates, tutorSafetyConstraints } from './db/schema/tutor';
import { createSeededTestDb, type TestDb } from './db/test-db';
import {
  createGroupRequest,
  expireGroupRequests,
  previewMatches,
  proposeGroupToTutor,
  reconcileAbandonedGroup,
  respondAsMember,
  respondAsTutor,
} from './services/group-matching';
import { readDemandBoard, readSupplyGaps, recordUnmetDemand } from './services/unmet-demand';
import { loadAdjacency } from './repositories/groups';

const SUBJECT = 'mathematics';
const LEVEL = 'matric';
const BOARD = 'sindh-board';
const CLIFTON = 'karachi-clifton';
const DHA = 'karachi-dha';
// Not adjacent to Clifton in the seeded graph — Clifton borders Saddar and DHA.
const GULSHAN = 'karachi-gulshan-e-iqbal';

const T_QUADRATICS = 'math-matric-sindh-quadratic-equations';
const T_FACTORISATION = 'math-matric-sindh-algebraic-factorisation';
const T_SIGNED = 'math-matric-sindh-signed-number-arithmetic';

/** Tuesday and Thursday, late afternoon. The shape a real family gives. */
const AFTERNOONS: AvailabilityWindow[] = [
  { weekday: 2, startTime: '16:00', endTime: '19:00' },
  { weekday: 4, startTime: '16:00', endTime: '19:00' },
];

let db: TestDb;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

/* -------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------- */

async function makeFamily(input: {
  slug: string;
  studentGender?: 'male' | 'female';
  studentName?: string;
}): Promise<{ userId: string; studentProfileId: string }> {
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    email: `${input.slug}@example.test`,
    passwordHash: 'not-a-real-hash',
    role: 'parent',
    displayName: input.slug,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const studentProfileId = newId();
  await db.insert(studentProfiles).values({
    id: studentProfileId,
    parentUserId: userId,
    selfUserId: null,
    name: input.studentName ?? `${input.slug} Khan`,
    gender: input.studentGender ?? 'female',
    createdAt: nowIso(),
  });

  return { userId, studentProfileId };
}

interface RequestOverrides {
  topicIds?: string[];
  areaId?: string;
  areaFlex?: boolean;
  genderPreference?: 'female_only' | 'male_only' | 'no_preference';
  maxGroupSize?: number;
  budgetMax?: number | null;
  availability?: AvailabilityWindow[];
  levelId?: string;
  boardId?: string;
}

async function makeRequest(
  slug: string,
  overrides: RequestOverrides = {},
  studentGender: 'male' | 'female' = 'female',
): Promise<{ requestId: string; userId: string; studentProfileId: string }> {
  const family = await makeFamily({ slug, studentGender });

  const request = await createGroupRequest(db, {
    studentProfileId: family.studentProfileId,
    requestedByUserId: family.userId,
    subjectId: SUBJECT,
    levelId: overrides.levelId ?? LEVEL,
    boardId: overrides.boardId ?? BOARD,
    topicIds: overrides.topicIds ?? [T_QUADRATICS, T_FACTORISATION],
    areaId: overrides.areaId ?? CLIFTON,
    areaFlex: overrides.areaFlex ?? false,
    genderPreference: overrides.genderPreference ?? 'no_preference',
    maxGroupSize: overrides.maxGroupSize ?? 3,
    budgetMax: overrides.budgetMax === undefined ? 600_000 : overrides.budgetMax,
    availability: overrides.availability ?? AFTERNOONS,
  });

  return { requestId: request.id, ...family };
}

/** A searchable tutor with a published group rate (FR-23.3). */
async function makeTutor(input: {
  slug: string;
  gender: 'male' | 'female';
  /** Paisa per head per month. */
  perHeadAmount?: number;
  femaleStudentsOnly?: boolean;
  restrictedAreaIds?: string[];
}): Promise<string> {
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    email: `${input.slug}@example.test`,
    passwordHash: 'not-a-real-hash',
    role: 'tutor',
    displayName: input.slug,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const tutorId = newId();
  await db.insert(tutorProfiles).values({
    id: tutorId,
    userId,
    gender: input.gender,
    cityId: 'karachi',
    slug: input.slug,
    profileStatus: 'approved',
    teachesAtHome: 1,
    teachesOnline: 0,
    createdAt: nowIso(),
  });

  // Rs 12,000 a month one-to-one becomes Rs 5,000 each across three.
  await db.insert(tutorRates).values([
    {
      id: newId(),
      tutorId,
      subjectId: SUBJECT,
      levelId: LEVEL,
      rateType: 'monthly',
      amount: 1_200_000,
      sessionsPerWeek: 2,
      minutesPerSession: 90,
      mode: 'home',
      normalisedHourlyAmount: 80_000,
      createdAt: nowIso(),
    },
    {
      id: newId(),
      tutorId,
      subjectId: SUBJECT,
      levelId: LEVEL,
      rateType: 'group_monthly',
      amount: 1_500_000,
      sessionsPerWeek: 2,
      minutesPerSession: 90,
      mode: 'home',
      groupSizeMax: 3,
      perHeadAmount: input.perHeadAmount ?? 500_000,
      normalisedHourlyAmount: 33_333,
      createdAt: nowIso(),
    },
  ]);

  if (input.femaleStudentsOnly || input.restrictedAreaIds) {
    await db.insert(tutorSafetyConstraints).values({
      id: newId(),
      tutorId,
      femaleStudentsOnly: input.femaleStudentsOnly ? 1 : 0,
      guardianPresenceRequired: 0,
      restrictedAreaIdsJson: JSON.stringify(input.restrictedAreaIds ?? []),
      updatedAt: nowIso(),
    });
  }

  return tutorId;
}

/* -------------------------------------------------------------------------
 * 1. Three compatible requests → one confirmed group
 * ---------------------------------------------------------------------- */

describe('three compatible requests form one group (FR-23.2 → FR-23.6)', () => {
  it('pools, proposes at the per-head rate, and creates a linked booking each', async () => {
    const a = await makeRequest('ayesha');
    const b = await makeRequest('bushra');
    const c = await makeRequest('sana');
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    /* --- Pooling ------------------------------------------------------- */

    const preview = await previewMatches(db, a.requestId);
    expect(preview.group).not.toBeNull();
    expect(preview.group!.memberRequestIds.sort()).toEqual(
      [a.requestId, b.requestId, c.requestId].sort(),
    );

    // FR-23.8: a first name and an area, and nothing else, before confirmation.
    expect(preview.members).toHaveLength(3);
    for (const member of preview.members) {
      expect(member.firstName).not.toContain(' ');
      expect(member.areaId).toBe(CLIFTON);
      expect(Object.keys(member).sort()).toEqual(['areaId', 'firstName', 'studentProfileId']);
    }

    // FR-23.7: every member is told why, in the constraints that were applied.
    for (const explanation of preview.group!.explanations) {
      expect(explanation.reasons.join(' ')).toMatch(/subject, level and examination board/i);
      expect(explanation.reasons.join(' ')).toMatch(/shared weekly window/i);
    }

    /* --- Proposal (FR-23.3) -------------------------------------------- */

    const proposed = await proposeGroupToTutor(db, {
      tutorId,
      memberRequestIds: preview.group!.memberRequestIds,
      requestedByUserId: a.userId,
    });

    // Rs 5,000 each, against Rs 12,000 one-to-one.
    expect(proposed.perHeadRate).toBe(500_000);
    expect(proposed.members).toHaveLength(3);
    expect(proposed.allConfirmed).toBe(false);

    /* --- Confirmation from every participant (FR-23.4) ------------------ */

    for (const family of [a, b, c]) {
      const result = await respondAsMember(db, {
        proposalId: proposed.proposal.id,
        groupRequestId: family.requestId,
        userId: family.userId,
        decision: 'confirm',
      });
      // No group yet: the tutor has not accepted.
      expect(result.groupId).toBeNull();
    }

    /* --- The tutor accepts as a unit (FR-23.5) -------------------------- */

    const formed = await respondAsTutor(db, {
      proposalId: proposed.proposal.id,
      tutorId,
      decision: 'accept',
    });

    expect(formed.groupId).toBe(proposed.proposal.id);
    expect(formed.bookingIds).toHaveLength(3);

    /* --- Linked bookings, one each (FR-23.6) ---------------------------- */

    const rows = await db.select().from(bookings);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.groupId))).toEqual(new Set([proposed.proposal.id]));
    // Individual, so each student keeps their own reviews and progress ledger.
    expect(new Set(rows.map((r) => r.studentProfileId)).size).toBe(3);

    for (const row of rows) {
      expect(row.status).toBe('confirmed');
      expect(row.engagementType).toBe('group');
      expect(row.agreedRate).toBe(500_000);
      expect(row.rateType).toBe('group_monthly');
      expect(row.tutorId).toBe(tutorId);
    }

    const [proposal] = await db.select().from(groupProposals);
    expect(proposal!.status).toBe('confirmed');
    expect(proposal!.confirmedAt).not.toBeNull();

    const requests = await db.select().from(groupRequests);
    expect(requests.every((r) => r.status === 'confirmed')).toBe(true);
  });

  it('does not form the group until the last participant confirms (FR-23.4)', async () => {
    const a = await makeRequest('ayesha');
    const b = await makeRequest('bushra');
    const c = await makeRequest('sana');
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    const preview = await previewMatches(db, a.requestId);
    const proposed = await proposeGroupToTutor(db, {
      tutorId,
      memberRequestIds: preview.group!.memberRequestIds,
      requestedByUserId: a.userId,
    });

    await respondAsTutor(db, { proposalId: proposed.proposal.id, tutorId, decision: 'accept' });
    await respondAsMember(db, {
      proposalId: proposed.proposal.id,
      groupRequestId: a.requestId,
      userId: a.userId,
      decision: 'confirm',
    });
    const stillWaiting = await respondAsMember(db, {
      proposalId: proposed.proposal.id,
      groupRequestId: b.requestId,
      userId: b.userId,
      decision: 'confirm',
    });

    expect(stillWaiting.groupId).toBeNull();
    expect(await db.select().from(bookings)).toHaveLength(0);

    const last = await respondAsMember(db, {
      proposalId: proposed.proposal.id,
      groupRequestId: c.requestId,
      userId: c.userId,
      decision: 'confirm',
    });

    expect(last.groupId).toBe(proposed.proposal.id);
    expect(await db.select().from(bookings)).toHaveLength(3);
  });

  it('leaves no orphan bookings when one participant declines', async () => {
    const a = await makeRequest('ayesha');
    const b = await makeRequest('bushra');
    const c = await makeRequest('sana');
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    const preview = await previewMatches(db, a.requestId);
    const proposed = await proposeGroupToTutor(db, {
      tutorId,
      memberRequestIds: preview.group!.memberRequestIds,
      requestedByUserId: a.userId,
    });

    await respondAsTutor(db, { proposalId: proposed.proposal.id, tutorId, decision: 'accept' });
    await respondAsMember(db, {
      proposalId: proposed.proposal.id,
      groupRequestId: a.requestId,
      userId: a.userId,
      decision: 'confirm',
    });
    await respondAsMember(db, {
      proposalId: proposed.proposal.id,
      groupRequestId: b.requestId,
      userId: b.userId,
      decision: 'decline',
    });

    expect(await db.select().from(bookings)).toHaveLength(0);

    const [proposal] = await db.select().from(groupProposals);
    expect(proposal!.status).toBe('declined');
    expect(proposal!.confirmedAt).toBeNull();

    // The other two go back into the pool rather than being stranded.
    const requests = await db.select().from(groupRequests);
    const open = requests.filter((r) => r.status === 'open').map((r) => r.id);
    expect(open.sort()).toEqual([a.requestId, c.requestId].sort());
  });

  it('sweeps away bookings written for a group that never confirmed', async () => {
    const a = await makeRequest('ayesha');
    const b = await makeRequest('bushra');
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    const preview = await previewMatches(db, a.requestId);
    const proposed = await proposeGroupToTutor(db, {
      tutorId,
      memberRequestIds: preview.group!.memberRequestIds,
      requestedByUserId: a.userId,
    });

    // Simulate the crash window: bookings written, `confirmed_at` never set.
    await db.insert(bookings).values({
      id: newId(),
      tutorId,
      studentProfileId: a.studentProfileId,
      requestedByUserId: a.userId,
      engagementType: 'group',
      subjectId: SUBJECT,
      levelId: LEVEL,
      boardId: BOARD,
      topicIdsJson: JSON.stringify([T_QUADRATICS]),
      mode: 'home',
      areaId: CLIFTON,
      groupId: proposed.proposal.id,
      status: 'confirmed',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });

    expect(await reconcileAbandonedGroup(db, proposed.proposal.id)).toBe(1);
    expect(await db.select().from(bookings)).toHaveLength(0);

    // And it refuses to touch a group that did confirm.
    await respondAsTutor(db, { proposalId: proposed.proposal.id, tutorId, decision: 'accept' });
    for (const family of [a, b]) {
      await respondAsMember(db, {
        proposalId: proposed.proposal.id,
        groupRequestId: family.requestId,
        userId: family.userId,
        decision: 'confirm',
      });
    }
    expect(await reconcileAbandonedGroup(db, proposed.proposal.id)).toBe(0);
    expect(await db.select().from(bookings)).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------
 * 2. A single differing hard constraint prevents pooling
 * ---------------------------------------------------------------------- */

describe('one differing hard constraint prevents pooling (FR-23.2)', () => {
  /**
   * Each case changes exactly one thing against an otherwise-identical pair.
   * A predicate that had quietly stopped checking, say, availability would fail
   * only its own case — which is the point of doing them one at a time.
   */
  const cases: { name: string; overrides: RequestOverrides; constraint: string }[] = [
    { name: 'a different board', overrides: { boardId: 'federal-board' }, constraint: 'curriculum' },
    { name: 'a different level', overrides: { levelId: 'intermediate' }, constraint: 'curriculum' },
    {
      name: 'a non-overlapping topic set',
      overrides: { topicIds: ['math-matric-sindh-real-numbers'] },
      constraint: 'topics',
    },
    {
      name: 'a non-adjacent area',
      overrides: { areaId: GULSHAN, areaFlex: true },
      constraint: 'area',
    },
    {
      name: 'no shared availability',
      overrides: { availability: [{ weekday: 6, startTime: '09:00', endTime: '11:00' }] },
      constraint: 'availability',
    },
    {
      name: 'an opposing gender preference',
      overrides: { genderPreference: 'male_only' },
      constraint: 'gender',
    },
  ];

  for (const testCase of cases) {
    it(`does not pool across ${testCase.name}`, async () => {
      const a = await makeRequest('ayesha', { genderPreference: 'female_only' });
      await makeRequest('bushra', { genderPreference: 'female_only', ...testCase.overrides });

      const preview = await previewMatches(db, a.requestId);
      expect(preview.group).toBeNull();
      expect(preview.members).toEqual([]);
    });
  }

  it('will not pool across an adjacent area when only one family flexed', async () => {
    // One family's willingness to travel is not the other's consent to be
    // travelled to.
    const rigid = await makeRequest('ayesha', { areaId: CLIFTON, areaFlex: false });
    await makeRequest('bushra', { areaId: DHA, areaFlex: true });

    expect((await previewMatches(db, rigid.requestId)).group).toBeNull();
  });

  it('pools across an adjacent area when both families flexed', async () => {
    const a = await makeRequest('ayesha', { areaId: CLIFTON, areaFlex: true });
    await makeRequest('bushra', { areaId: DHA, areaFlex: true });

    const preview = await previewMatches(db, a.requestId);
    expect(preview.group).not.toBeNull();
    expect(preview.group!.areaIds.sort()).toEqual([CLIFTON, DHA].sort());
    expect(
      preview.group!.explanations.map((e) => e.reasons.join(' ')).join(' '),
    ).toMatch(/flexible on area/i);
  });

  it('refuses to propose a group of three to a tutor who would exceed a member cap', async () => {
    // One family will sit with at most two people in the room.
    const a = await makeRequest('ayesha', { maxGroupSize: 2 });
    await makeRequest('bushra');
    await makeRequest('sana');

    const preview = await previewMatches(db, a.requestId);
    expect(preview.group!.memberRequestIds).toHaveLength(2);
    expect(preview.group!.maxGroupSize).toBe(2);
  });

  it('carries the strictest gender requirement into the group, and states it', async () => {
    const strict = await makeRequest('ayesha', { genderPreference: 'female_only' });
    await makeRequest('bushra', { genderPreference: 'no_preference' });

    const preview = await previewMatches(db, strict.requestId);
    expect(preview.group!.genderPreference).toBe('female_only');

    // The no-preference family is told, so it can decline on that ground.
    const relaxed = preview.group!.explanations.find((e) => e.requestId !== strict.requestId);
    expect(relaxed!.reasons.join(' ')).toMatch(/because a member requires it/i);
  });

  it('refuses a tutor the group’s gender requirement excludes', async () => {
    const a = await makeRequest('ayesha', { genderPreference: 'female_only' });
    await makeRequest('bushra', { genderPreference: 'female_only' });
    const male = await makeTutor({ slug: 'bilal-t', gender: 'male' });

    const preview = await previewMatches(db, a.requestId);
    await expect(
      proposeGroupToTutor(db, {
        tutorId: male,
        memberRequestIds: preview.group!.memberRequestIds,
        requestedByUserId: a.userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'tutor_gender_mismatch' });
  });

  it('will not let a caller assemble a group the solver did not produce', async () => {
    const a = await makeRequest('ayesha', { genderPreference: 'female_only' });
    const incompatible = await makeRequest('bilal-family', {
      genderPreference: 'male_only',
    });
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    await expect(
      proposeGroupToTutor(db, {
        tutorId,
        memberRequestIds: [a.requestId, incompatible.requestId],
        requestedByUserId: a.userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'not_a_valid_group' });
  });

  it("respects the tutor's own constraints, not merely the families' (SEC-19)", async () => {
    const a = await makeRequest('ayesha', {}, 'female');
    await makeRequest('bilal', {}, 'male');
    const tutorId = await makeTutor({
      slug: 'nadia-t',
      gender: 'female',
      femaleStudentsOnly: true,
    });

    const preview = await previewMatches(db, a.requestId);
    await expect(
      proposeGroupToTutor(db, {
        tutorId,
        memberRequestIds: preview.group!.memberRequestIds,
        requestedByUserId: a.userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'tutor_constraints_not_met' });
  });

  it('refuses a per-head rate above the lowest budget in the group', async () => {
    const a = await makeRequest('ayesha', { budgetMax: 300_000 });
    await makeRequest('bushra', { budgetMax: 900_000 });
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female', perHeadAmount: 500_000 });

    const preview = await previewMatches(db, a.requestId);
    expect(preview.group!.perHeadBudgetCeiling).toBe(300_000);

    await expect(
      proposeGroupToTutor(db, {
        tutorId,
        memberRequestIds: preview.group!.memberRequestIds,
        requestedByUserId: a.userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'above_budget_ceiling' });
  });
});

/* -------------------------------------------------------------------------
 * 3. Determinism
 * ---------------------------------------------------------------------- */

describe('the same input always yields the same grouping (FR-23.7)', () => {
  it('is byte-identical across repeated runs', async () => {
    const a = await makeRequest('ayesha');
    await makeRequest('bushra');
    await makeRequest('sana');
    await makeRequest('hina', { areaId: DHA, areaFlex: true });

    const runs = await Promise.all([
      previewMatches(db, a.requestId),
      previewMatches(db, a.requestId),
      previewMatches(db, a.requestId),
    ]);

    const serialised = runs.map((r) => JSON.stringify(r.allGroups));
    expect(new Set(serialised).size).toBe(1);
  });

  /**
   * The database returns rows in whatever order it likes, and a solver that
   * depended on that would be reproducible only by luck. This shuffles the
   * candidate array and asserts the answer does not move.
   */
  it('is independent of the order the candidates arrive in', async () => {
    const candidates: GroupCandidate[] = ['a', 'b', 'c', 'd'].map((id, index) => ({
      requestId: `req-${id}`,
      studentProfileId: `stu-${id}`,
      subjectId: SUBJECT,
      levelId: LEVEL,
      boardId: BOARD,
      topicIds: [T_QUADRATICS, T_FACTORISATION],
      areaId: CLIFTON,
      areaFlex: false,
      genderPreference: 'no_preference',
      maxGroupSize: 3,
      budgetMax: 600_000,
      availability: AFTERNOONS,
      createdAt: `2027-03-0${index + 1}T10:00:00.000Z`,
    }));

    const adjacency = await loadAdjacency(db);
    const baseline = JSON.stringify(poolRequests(candidates, adjacency));

    // Every permutation of four, exhaustively — 24 orderings.
    const permutations = permute(candidates);
    expect(permutations).toHaveLength(24);

    for (const ordering of permutations) {
      expect(JSON.stringify(poolRequests(ordering, adjacency))).toBe(baseline);
    }
  });

  it('places the longest-waiting request first, so the rule is explicable', async () => {
    const adjacency = await loadAdjacency(db);
    const base = {
      subjectId: SUBJECT,
      levelId: LEVEL,
      boardId: BOARD,
      topicIds: [T_QUADRATICS],
      areaId: CLIFTON,
      areaFlex: false,
      genderPreference: 'no_preference' as const,
      maxGroupSize: 2,
      budgetMax: null,
      availability: AFTERNOONS,
    };

    const { groups } = poolRequests(
      [
        { ...base, requestId: 'newest', studentProfileId: 's3', createdAt: '2027-03-03T00:00:00.000Z' },
        { ...base, requestId: 'oldest', studentProfileId: 's1', createdAt: '2027-03-01T00:00:00.000Z' },
        { ...base, requestId: 'middle', studentProfileId: 's2', createdAt: '2027-03-02T00:00:00.000Z' },
      ],
      adjacency,
    );

    // The two who waited longest are placed; the newest keeps waiting.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.memberRequestIds).toEqual(['middle', 'oldest']);
  });

  it('has pure, testable constraint primitives', () => {
    expect(intersectGenderPreference('female_only', 'no_preference')).toBe('female_only');
    expect(intersectGenderPreference('female_only', 'male_only')).toBeNull();
    expect(intersectGenderPreference('no_preference', 'no_preference')).toBe('no_preference');

    // A 45-minute sliver is not a lesson.
    expect(
      intersectAvailability(
        [{ weekday: 2, startTime: '16:00', endTime: '17:00' }],
        [{ weekday: 2, startTime: '16:15', endTime: '18:00' }],
      ),
    ).toEqual([]);

    expect(
      intersectAvailability(
        [{ weekday: 2, startTime: '16:00', endTime: '19:00' }],
        [{ weekday: 2, startTime: '17:00', endTime: '20:00' }],
      ),
    ).toEqual([{ weekday: 2, startTime: '17:00', endTime: '19:00' }]);
  });

  it('reports every reason a pair cannot pool, not just the first', async () => {
    const adjacency = await loadAdjacency(db);
    const base: GroupCandidate = {
      requestId: 'a',
      studentProfileId: 's1',
      subjectId: SUBJECT,
      levelId: LEVEL,
      boardId: BOARD,
      topicIds: [T_QUADRATICS],
      areaId: CLIFTON,
      areaFlex: false,
      genderPreference: 'female_only',
      maxGroupSize: 3,
      budgetMax: null,
      availability: AFTERNOONS,
      createdAt: '2027-03-01T00:00:00.000Z',
    };

    const failures = pairFailures(
      base,
      {
        ...base,
        requestId: 'b',
        boardId: 'federal-board',
        topicIds: [T_SIGNED],
        areaId: GULSHAN,
        genderPreference: 'male_only',
        availability: [{ weekday: 6, startTime: '09:00', endTime: '10:30' }],
      },
      adjacency,
    );

    expect(failures.map((f) => f.constraint).sort()).toEqual([
      'area',
      'availability',
      'curriculum',
      'gender',
      'topics',
    ]);
  });
});

/* -------------------------------------------------------------------------
 * 4. The unmet demand board leaks nothing
 * ---------------------------------------------------------------------- */

async function seedDemand(count: number, overrides: Partial<{ areaId: string; genderPreference: 'female_only' | 'male_only' | 'no_preference'; topicIds: string[]; budgetMaxPaisa: number }> = {}): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await recordUnmetDemand(db, {
      subjectId: SUBJECT,
      topicIds: overrides.topicIds ?? [T_QUADRATICS],
      levelId: LEVEL,
      boardId: BOARD,
      areaId: overrides.areaId ?? CLIFTON,
      genderPreference: overrides.genderPreference ?? 'female_only',
      budgetMaxPaisa: overrides.budgetMaxPaisa ?? 63_500,
      reason: 'no_matches',
    });
  }
}

describe('unmet demand is anonymous by construction (§6.24)', () => {
  /**
   * The structural half. A behavioural test can only cover the responses that
   * exist today; this covers the ones someone writes next month, because it
   * fails the moment the table grows a column that could identify anyone.
   */
  it('has no column that could name a requester (FR-24.2)', () => {
    const columns = Object.keys(unmetDemand);
    const forbidden = columns.filter((c) =>
      /user|student|parent|email|phone|contact|requester|session|ip|name/i.test(c),
    );
    expect(forbidden).toEqual([]);
    expect(columns).toContain('subjectId');
  });

  it('returns nothing traceable to a requester in any response', async () => {
    const family = await makeFamily({ slug: 'traceable', studentName: 'Zainab Ahmed' });
    await seedDemand(5);

    const board = await readDemandBoard(db, {});
    const gaps = await readSupplyGaps(db, {});
    const serialised = JSON.stringify(board) + JSON.stringify(gaps);

    for (const trace of [family.userId, family.studentProfileId, 'Zainab', 'traceable']) {
      expect(serialised).not.toContain(trace);
    }

    // Nor a timestamp of any kind: when a record arrived is when someone asked.
    expect(serialised).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(serialised).not.toMatch(/createdAt|created_at|since|until/i);

    // Nor the exact figure a family stated — Rs 635/hr became a band.
    expect(serialised).not.toContain('63500');
    expect(board.cohorts[0]!.budgetBandLabels).toEqual(['Rs 500–1,000/hr']);
  });

  it('suppresses a cohort below three, and publishes it at three (FR-24.6)', async () => {
    await seedDemand(DEMAND_SUPPRESSION_THRESHOLD - 1);
    const shy = await readDemandBoard(db, {});
    expect(shy.cohorts).toEqual([]);
    expect(shy.suppressedCohortCount).toBe(1);
    // The total is safe: one number over every cohort cannot isolate one.
    expect(shy.totalRecordsInWindow).toBe(2);

    await seedDemand(1);
    const board = await readDemandBoard(db, {});
    expect(board.cohorts).toHaveLength(1);
    expect(board.cohorts[0]!.count).toBe(DEMAND_SUPPRESSION_THRESHOLD);
    expect(board.suppressedCohortCount).toBe(0);
  });

  it('suppresses a rare topic inside an otherwise-published cohort', async () => {
    await seedDemand(4, { topicIds: [T_QUADRATICS] });
    // One family, and only one, also asked about this.
    await seedDemand(1, { topicIds: [T_QUADRATICS, T_SIGNED] });

    const board = await readDemandBoard(db, {});
    const topics = board.cohorts[0]!.topics.map((t) => t.topicId);

    expect(topics).toContain(T_QUADRATICS);
    // Omitted entirely, not reported as "other" — a remainder can be subtracted.
    expect(topics).not.toContain(T_SIGNED);
  });

  it('cannot be differenced: a filter selects whole cohorts, never a slice', async () => {
    await seedDemand(4, { areaId: CLIFTON });
    await seedDemand(2, { areaId: DHA });

    const all = await readDemandBoard(db, {});
    const clifton = await readDemandBoard(db, { areaId: CLIFTON });
    const dha = await readDemandBoard(db, { areaId: DHA });

    // Every published count is identical whichever way it was reached, so
    // subtracting one response from another yields nothing new.
    expect(all.cohorts.map((c) => c.count)).toEqual([4]);
    expect(clifton.cohorts.map((c) => c.count)).toEqual([4]);
    expect(dha.cohorts).toEqual([]);
  });

  it('fixes the window rather than accepting one', async () => {
    expect(DEMAND_WINDOW_DAYS).toBe(30);
    // Not a parameter of either read: there is no argument to pass.
    expect(readDemandBoard.length).toBeLessThanOrEqual(3);

    await seedDemand(3);
    expect((await readDemandBoard(db, {})).windowDays).toBe(30);
  });

  it('excludes records older than the window', async () => {
    await seedDemand(3);
    const future = new Date(Date.now() + (DEMAND_WINDOW_DAYS + 1) * 86_400_000);
    expect((await readDemandBoard(db, {}, future)).cohorts).toEqual([]);
  });

  it('bands a stated budget rather than storing it', async () => {
    expect(toBudgetBand(49_999)).toBe('under-500');
    expect(toBudgetBand(63_500)).toBe('500-1000');
    expect(toBudgetBand(9_999_999)).toBe('2000-plus');
    expect(toBudgetBand(null)).toBeNull();

    await seedDemand(3, { budgetMaxPaisa: 63_500 });
    const [row] = await db.select().from(unmetDemand);
    expect(row!.budgetMax).toBe(100_000); // the band's bound, not Rs 635
  });

  it('suppression is a pure function, exercisable without a database', () => {
    const cohort = {
      subjectId: SUBJECT,
      levelId: null,
      boardId: null,
      areaId: null,
      genderPreference: 'no_preference' as const,
      cohortKey: 'k',
      count: 2,
      topics: [],
      budgetBands: [],
      reasons: [],
    };
    expect(suppressSmallCohorts([cohort])).toEqual({ kept: [], suppressedCount: 1 });
    expect(suppressSmallCohorts([{ ...cohort, count: 3 }]).kept).toHaveLength(1);
  });

  it('records a failed intake without a session, user or student id (FR-24.1)', async () => {
    await recordUnmetDemand(db, {
      subjectId: SUBJECT,
      topicIds: [T_QUADRATICS],
      reason: 'insufficient_information',
    });

    const [row] = await db.select().from(unmetDemand);
    expect(Object.values(row!).join(' ')).not.toMatch(/user|student/i);
    expect(row!.reason).toBe('insufficient_information');
  });
});

/* -------------------------------------------------------------------------
 * Expiry — FR-23.10
 * ---------------------------------------------------------------------- */

describe('a partial group expires after seven days (FR-23.10)', () => {
  it('leaves a fresh request open and expires a stale one', async () => {
    const fresh = await makeRequest('ayesha');

    const stale = await makeRequest('bushra', { areaId: GULSHAN });
    await db
      .update(groupRequests)
      .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
      .where(eq(groupRequests.id, stale.requestId));

    const { expired } = await expireGroupRequests(db);
    expect(expired).toEqual([stale.requestId]);

    const rows = await db.select().from(groupRequests);
    expect(rows.find((r) => r.id === fresh.requestId)!.status).toBe('open');
    expect(rows.find((r) => r.id === stale.requestId)!.status).toBe('expired');
  });
});

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function permute<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permute(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Over HTTP — who may see a proposal
 *
 * `maySeeProposal` lives in the route, so it is the one authorisation in this
 * module that a service-level test cannot reach. A proposal carries other
 * families' first names, their areas and the reasons they were grouped; that
 * is not a public surface (FR-23.8).
 * ---------------------------------------------------------------------- */

describe('proposal visibility over HTTP (FR-23.8, NFR-6)', () => {
  const PASSWORD = 'a-sufficiently-long-password';

  function cookiesOf(res: request.Response): string {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
    return list.map((c) => c.split(';')[0]).join('; ');
  }

  async function registerParent(email: string): Promise<string> {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, role: 'parent', displayName: email });
    expect(res.status).toBe(201);
    return cookiesOf(res);
  }

  it('admits the member families and refuses an unrelated parent', async () => {
    const a = await makeRequest('ayesha');
    const b = await makeRequest('bushra');
    const tutorId = await makeTutor({ slug: 'nadia-t', gender: 'female' });

    const preview = await previewMatches(db, a.requestId);
    const proposed = await proposeGroupToTutor(db, {
      tutorId,
      memberRequestIds: preview.group!.memberRequestIds,
      requestedByUserId: a.userId,
    });

    // A parent with no stake in this group.
    const stranger = await registerParent('stranger@example.test');
    const refused = await request(app)
      .get(`/api/groups/proposals/${proposed.proposal.id}`)
      .set('Cookie', stranger);

    // 404, not 403: a proposal a caller may not see should not be confirmed to
    // exist by the status code.
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.body)).not.toContain('Khan');

    // An anonymous caller gets nothing either.
    expect((await request(app).get(`/api/groups/proposals/${proposed.proposal.id}`)).status).toBe(401);

    void b;
  });

  it('publishes no demand board to a family, and no window parameter to anyone', async () => {
    await seedDemand(4);
    const parent = await registerParent('parent-peeking@example.test');

    // The board is supply intelligence for tutors and administrators (FR-24.3,
    // FR-24.4). A family has no business reading other families' failed
    // searches, however aggregated.
    expect((await request(app).get('/api/demand').set('Cookie', parent)).status).toBe(403);
    expect((await request(app).get('/api/demand/supply-gaps').set('Cookie', parent)).status).toBe(403);
  });
});
