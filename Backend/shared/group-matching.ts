/**
 * Group tuition matching — §6.23, FR-23.1 to FR-23.10.
 *
 * Twelve thousand rupees a month one-to-one becomes five thousand each across
 * three students. The tutor earns more per hour and every family pays less.
 *
 * ── Why this file is pure, and why it is not AI ─────────────────────────────
 *
 * FR-23.7 requires deterministic constraint satisfaction in application code
 * with no model involved, and decision 10 gives the reason: **a family needs to
 * be told why it was grouped with these particular students.** A solver can
 * answer that from the constraints it actually applied. A model can only
 * produce a plausible sentence, and a plausible sentence about who your
 * fifteen-year-old will be sitting next to every week is not good enough.
 *
 * So everything here is a pure function of its inputs. No database, no clock,
 * no randomness, no iteration over an unordered collection. The same input
 * always yields the same grouping, byte for byte, and
 * `server/group-matching.flow.test.ts` asserts exactly that.
 *
 * ── Hard constraints ────────────────────────────────────────────────────────
 *
 * Every one of these must agree between **every pair** of members, not merely
 * between each member and the seed:
 *
 *   · same subject, level and board — a Sindh Board matric class is not a
 *     Federal Board one, and pretending otherwise wastes everyone's term;
 *   · sufficiently overlapping topic sets;
 *   · same area, or adjacent areas when **both** families flexed;
 *   · a shared weekly availability window of usable length;
 *   · compatible gender preference (see `intersectGenderPreference`);
 *   · a group size no larger than the smallest maximum any member set.
 *
 * A constraint that does not agree removes the pairing. There is no scoring,
 * no "close enough", and no ranking — the same discipline the search filter
 * gets (CLAUDE.md §2.4), for the same reason.
 */

import { z } from 'zod';

import { GENDER_PREFERENCES, type GenderPreference } from './search';

/* -------------------------------------------------------------------------
 * Availability
 * ---------------------------------------------------------------------- */

/**
 * A weekly recurring window. `HH:MM` text in Pakistan local time, deliberately
 * not a timestamp: lexicographic order on zero-padded `HH:MM` is chronological
 * order, which is the only property the overlap test needs, and it behaves
 * identically in both database dialects (CLAUDE.md §2.1).
 */
export const availabilityWindowSchema = z.object({
  /** 0 = Sunday … 6 = Saturday. */
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM'),
});

export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

export const availabilitySchema = z
  .array(availabilityWindowSchema)
  .min(1)
  .max(21)
  .refine((windows) => windows.every((w) => w.startTime < w.endTime), {
    message: 'each window must end after it starts',
  });

/**
 * The shortest overlap worth calling a shared slot.
 *
 * Below an hour there is no lesson in it, and pooling two families around
 * fifteen shared minutes would produce a group that cannot actually meet.
 */
export const MIN_SHARED_MINUTES = 60;

/** Topic-set agreement required to pool, as a fraction of the smaller set. */
export const MIN_TOPIC_OVERLAP = 0.5;

const minutesOf = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const toHhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * The windows two availabilities share.
 *
 * Returned sorted and merged, so the result is a canonical value: two callers
 * with the same inputs in a different order get the same array.
 */
export function intersectAvailability(
  a: AvailabilityWindow[],
  b: AvailabilityWindow[],
): AvailabilityWindow[] {
  const out: AvailabilityWindow[] = [];

  for (const left of a) {
    for (const right of b) {
      if (left.weekday !== right.weekday) continue;

      const start = Math.max(minutesOf(left.startTime), minutesOf(right.startTime));
      const end = Math.min(minutesOf(left.endTime), minutesOf(right.endTime));

      if (end - start >= MIN_SHARED_MINUTES) {
        out.push({ weekday: left.weekday, startTime: toHhmm(start), endTime: toHhmm(end) });
      }
    }
  }

  return out.sort(
    (x, y) => x.weekday - y.weekday || x.startTime.localeCompare(y.startTime),
  );
}

/* -------------------------------------------------------------------------
 * Gender preference — a hard constraint, carried into the group
 * ---------------------------------------------------------------------- */

/**
 * The group's requirement is the **strictest** of its members'.
 *
 * `female_only` and `no_preference` pool: the group takes a female tutor, which
 * the first family required and the second accepts by definition. `female_only`
 * and `male_only` never pool — there is no tutor who satisfies both, and a
 * group that cannot be staffed is worse than no group.
 *
 * Note what this does **not** do. It never relaxes a stated preference, and it
 * never sets one on a family's behalf (FR-16.6): a `no_preference` family's own
 * record is untouched. It ends up in a group that will be staffed by a female
 * tutor, which is a consequence of the pooling it opted into and is stated in
 * the explanation it is shown — so the family can decline on exactly that
 * ground before anything is confirmed.
 */
export function intersectGenderPreference(
  a: GenderPreference,
  b: GenderPreference,
): GenderPreference | null {
  if (a === b) return a;
  if (a === 'no_preference') return b;
  if (b === 'no_preference') return a;
  return null; // female_only vs male_only
}

/* -------------------------------------------------------------------------
 * The candidate
 * ---------------------------------------------------------------------- */

/**
 * One open request, as the solver sees it.
 *
 * Deliberately carries no name, no contact and no user id. FR-23.8 limits what
 * a participant learns about another to a first name and an area until the
 * group confirms, and the cheapest way to honour that is for the matcher never
 * to receive anything more.
 */
export interface GroupCandidate {
  requestId: string;
  studentProfileId: string;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds: string[];
  areaId: string;
  areaFlex: boolean;
  genderPreference: GenderPreference;
  maxGroupSize: number;
  /** Paisa per head per month. `null` means no ceiling was stated. */
  budgetMax: number | null;
  availability: AvailabilityWindow[];
  /** ISO-8601 UTC. Orders the sweep; never compared as a Date. */
  createdAt: string;
}

/** `areaId` → the set of areas adjacent to it. */
export type AdjacencyMap = ReadonlyMap<string, ReadonlySet<string>>;

export const GROUP_CONSTRAINTS = [
  'curriculum',
  'topics',
  'area',
  'availability',
  'gender',
  'size',
  'budget',
] as const;

export type GroupConstraint = (typeof GROUP_CONSTRAINTS)[number];

export interface ConstraintFailure {
  constraint: GroupConstraint;
  /** Shown to a family. Names the constraint, never another family. */
  detail: string;
}

/* -------------------------------------------------------------------------
 * Pairwise compatibility
 * ---------------------------------------------------------------------- */

function topicOverlap(a: string[], b: string[]): number {
  const left = new Set(a);
  const shared = b.filter((t) => left.has(t)).length;
  const smaller = Math.min(a.length, b.length);
  return smaller === 0 ? 0 : shared / smaller;
}

function areasAgree(a: GroupCandidate, b: GroupCandidate, adjacency: AdjacencyMap): boolean {
  if (a.areaId === b.areaId) return true;
  // Both must have flexed. One family's willingness to travel is not the
  // other's consent to be travelled to (FR-23.1).
  if (!a.areaFlex || !b.areaFlex) return false;
  return adjacency.get(a.areaId)?.has(b.areaId) === true;
}

/**
 * Why two requests cannot pool — every reason, not just the first.
 *
 * Returning the complete list is what lets a family be told "not this group,
 * because the availability does not overlap and the board differs" rather than
 * being told nothing, which is the FR-23.7 promise in practice.
 */
export function pairFailures(
  a: GroupCandidate,
  b: GroupCandidate,
  adjacency: AdjacencyMap,
): ConstraintFailure[] {
  const failures: ConstraintFailure[] = [];

  if (a.subjectId !== b.subjectId || a.levelId !== b.levelId || a.boardId !== b.boardId) {
    failures.push({
      constraint: 'curriculum',
      detail: 'The subject, level or examination board differs.',
    });
  }

  if (topicOverlap(a.topicIds, b.topicIds) < MIN_TOPIC_OVERLAP) {
    failures.push({
      constraint: 'topics',
      detail: 'The topics asked for do not overlap enough to be taught together.',
    });
  }

  if (!areasAgree(a, b, adjacency)) {
    failures.push({
      constraint: 'area',
      detail: 'The areas are neither the same nor adjacent with both families flexible.',
    });
  }

  if (intersectAvailability(a.availability, b.availability).length === 0) {
    failures.push({
      constraint: 'availability',
      detail: `No weekly window of at least ${MIN_SHARED_MINUTES} minutes is shared.`,
    });
  }

  if (intersectGenderPreference(a.genderPreference, b.genderPreference) === null) {
    failures.push({
      constraint: 'gender',
      detail: 'One requires a female tutor and the other a male tutor.',
    });
  }

  return failures;
}

/* -------------------------------------------------------------------------
 * The grouping
 * ---------------------------------------------------------------------- */

/**
 * One reason, as data rather than as a sentence.
 *
 * `reasons` below is English prose assembled here, and prose assembled in the
 * solver is prose the Urdu view cannot render. Decision 10 says a family is
 * entitled to know why it was grouped; that entitlement does not stop at the
 * language toggle, and §6.27 keeps every interface string in the dictionary
 * rather than in the code that computes things.
 *
 * So each reason also travels as a code and its numbers, and the client renders
 * it through i18next. The solver acquires no language, and the prose stays for
 * callers that have no dictionary — the API, a log line, a test.
 */
export interface GroupReasonCode {
  code:
    | 'same_curriculum'
    | 'shared_topics'
    | 'same_area'
    | 'adjacent_area'
    | 'shared_window'
    | 'gender_own'
    | 'gender_other'
    | 'within_cap';
  /** Interpolation values. Never a name, never an id — counts and times only. */
  params: Record<string, string | number>;
}

export interface GroupMemberExplanation {
  requestId: string;
  studentProfileId: string;
  /** Everything that had to agree for this member to be here. */
  reasons: string[];
  /** The same list, as codes the interface can translate. Same order. */
  reasonCodes: GroupReasonCode[];
}

export interface CandidateGroup {
  /**
   * Derived from the sorted member request ids, so the same set of members
   * always produces the same key regardless of how they were discovered. Used
   * to recognise a re-proposed group rather than duplicating it.
   */
  groupKey: string;
  memberRequestIds: string[];
  subjectId: string;
  levelId: string;
  boardId: string;
  /** The seed's area. Members sit in this area or one adjacent to it. */
  areaId: string;
  areaIds: string[];
  /** The intersection of every member's topic set, sorted. */
  sharedTopicIds: string[];
  /** The intersection of every member's availability. Never empty. */
  sharedAvailability: AvailabilityWindow[];
  /** The strictest requirement any member stated. */
  genderPreference: GenderPreference;
  /** The smallest maximum any member set. The group never exceeds it. */
  maxGroupSize: number;
  /**
   * Paisa per head per month. The lowest ceiling any member stated, or `null`
   * when nobody stated one. A per-head rate above this cannot be proposed.
   */
  perHeadBudgetCeiling: number | null;
  explanations: GroupMemberExplanation[];
}

export interface GroupingResult {
  groups: CandidateGroup[];
  /** Requests that pooled with nobody. They keep waiting (FR-23.10). */
  unpooledRequestIds: string[];
}

/** Stable across engines and locales: ids are slugs and ASCII ids. */
function bySeedOrder(a: GroupCandidate, b: GroupCandidate): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0;
}

/**
 * Pool open requests into groups.
 *
 * **Greedy, seeded in creation order, and deliberately not optimal.** The
 * oldest unpooled request seeds a group and the next-oldest compatible requests
 * join it, each checked against *every* member already in — so compatibility is
 * a property of the whole group, not a chain of pairwise agreements that drifts
 * apart at the ends.
 *
 * Optimal set-partitioning would place more families overall. It is also
 * NP-hard, it produces a different answer whenever the input changes anywhere,
 * and it cannot explain itself. Seniority is a rule a family can be told:
 * *you waited longest, so you were placed first.* That is worth more here than
 * a few extra placements.
 */
export function poolRequests(
  candidates: readonly GroupCandidate[],
  adjacency: AdjacencyMap,
): GroupingResult {
  const ordered = [...candidates].sort(bySeedOrder);
  const taken = new Set<string>();
  const groups: CandidateGroup[] = [];

  for (const seed of ordered) {
    if (taken.has(seed.requestId)) continue;

    const members: GroupCandidate[] = [seed];
    let gender = seed.genderPreference;
    let availability = seed.availability;
    let sizeCap = seed.maxGroupSize;

    for (const candidate of ordered) {
      if (candidate.requestId === seed.requestId) continue;
      if (taken.has(candidate.requestId)) continue;
      if (members.length >= sizeCap || members.length >= candidate.maxGroupSize) continue;

      // Against every member already in, not merely against the seed.
      if (members.some((m) => pairFailures(m, candidate, adjacency).length > 0)) continue;

      const nextGender = intersectGenderPreference(gender, candidate.genderPreference);
      if (nextGender === null) continue;

      const nextAvailability = intersectAvailability(availability, candidate.availability);
      if (nextAvailability.length === 0) continue;

      members.push(candidate);
      gender = nextGender;
      availability = nextAvailability;
      sizeCap = Math.min(sizeCap, candidate.maxGroupSize);
    }

    // One family is not a group. The request stays open and keeps waiting.
    if (members.length < 2) continue;

    for (const member of members) taken.add(member.requestId);
    groups.push(buildGroup(members, availability, gender, sizeCap, adjacency));
  }

  return {
    groups,
    unpooledRequestIds: ordered
      .filter((c) => !taken.has(c.requestId))
      .map((c) => c.requestId),
  };
}

function buildGroup(
  members: GroupCandidate[],
  sharedAvailability: AvailabilityWindow[],
  genderPreference: GenderPreference,
  maxGroupSize: number,
  adjacency: AdjacencyMap,
): CandidateGroup {
  const [seed] = members as [GroupCandidate, ...GroupCandidate[]];

  const sharedTopicIds = members
    .reduce<string[]>(
      (shared, member) => shared.filter((t) => member.topicIds.includes(t)),
      [...seed.topicIds],
    )
    .sort();

  const ceilings = members
    .map((m) => m.budgetMax)
    .filter((b): b is number => b !== null);

  const memberRequestIds = members.map((m) => m.requestId).sort();

  return {
    groupKey: memberRequestIds.join('|'),
    memberRequestIds,
    subjectId: seed.subjectId,
    levelId: seed.levelId,
    boardId: seed.boardId,
    areaId: seed.areaId,
    areaIds: [...new Set(members.map((m) => m.areaId))].sort(),
    sharedTopicIds,
    sharedAvailability,
    genderPreference,
    maxGroupSize,
    perHeadBudgetCeiling: ceilings.length > 0 ? Math.min(...ceilings) : null,
    explanations: members
      .map((member) => ({
        requestId: member.requestId,
        studentProfileId: member.studentProfileId,
        ...explain(member, members, sharedAvailability, genderPreference, adjacency),
      }))
      .sort((a, b) => a.requestId.localeCompare(b.requestId)),
  };
}

/**
 * Why this member is in this group — FR-23.7's actual deliverable.
 *
 * Written from the constraints the solver applied, in the order it applied
 * them, and phrased so it names no other family. "Two others" is a count; a
 * count is not an identity (FR-23.8).
 */
function explain(
  member: GroupCandidate,
  members: GroupCandidate[],
  sharedAvailability: AvailabilityWindow[],
  genderPreference: GenderPreference,
  adjacency: AdjacencyMap,
): { reasons: string[]; reasonCodes: GroupReasonCode[] } {
  const others = members.filter((m) => m.requestId !== member.requestId);
  const reasons: string[] = [
    `Same subject, level and examination board as the other ${others.length === 1 ? 'family' : `${others.length} families`}.`,
  ];
  const reasonCodes: GroupReasonCode[] = [
    { code: 'same_curriculum', params: { others: others.length } },
  ];

  const sharedTopics = members.reduce<string[]>(
    (shared, m) => shared.filter((t) => m.topicIds.includes(t)),
    [...member.topicIds],
  );
  reasons.push(
    `${sharedTopics.length} topic${sharedTopics.length === 1 ? '' : 's'} asked for by everyone in the group.`,
  );
  reasonCodes.push({ code: 'shared_topics', params: { count: sharedTopics.length } });

  const sameArea = others.every((o) => o.areaId === member.areaId);
  if (sameArea) {
    reasons.push('Everyone is in the same area.');
    reasonCodes.push({ code: 'same_area', params: {} });
  } else {
    const neighbours = others.filter(
      (o) => o.areaId !== member.areaId && adjacency.get(member.areaId)?.has(o.areaId) === true,
    );
    reasons.push(
      `You marked yourself flexible on area, and ${neighbours.length === 1 ? 'one family is' : `${neighbours.length} families are`} in an adjacent area.`,
    );
    reasonCodes.push({ code: 'adjacent_area', params: { count: neighbours.length } });
  }

  const window = sharedAvailability
    .map((w) => `${WEEKDAY_NAMES[w.weekday]} ${w.startTime}–${w.endTime}`)
    .join(', ');
  reasons.push(`A shared weekly window: ${window}.`);
  /*
   * The weekday is a number, not `WEEKDAY_NAMES[w.weekday]`. The client has its
   * own names for the days in both languages; sending "Tuesday" would put an
   * English word inside an Urdu sentence, which is the failure this whole
   * change exists to avoid.
   */
  reasonCodes.push({
    code: 'shared_window',
    params: {
      windows: sharedAvailability
        .map((w) => `${w.weekday}|${w.startTime}|${w.endTime}`)
        .join(','),
    },
  });

  if (genderPreference !== 'no_preference') {
    const own = member.genderPreference === genderPreference;
    reasons.push(
      own
        ? `The group will be taught by a ${genderPreference === 'female_only' ? 'female' : 'male'} tutor, as you required.`
        : // Stated plainly, because the family should be able to decline on
          // exactly this ground before anything is confirmed.
          `The group will be taught by a ${genderPreference === 'female_only' ? 'female' : 'male'} tutor, because a member requires it. You stated no preference.`,
    );
    reasonCodes.push({
      code: own ? 'gender_own' : 'gender_other',
      params: { gender: genderPreference === 'female_only' ? 'female' : 'male' },
    });
  }

  const cap = Math.min(...members.map((m) => m.maxGroupSize));
  reasons.push(`Group of ${members.length}, within the smallest maximum anyone set (${cap}).`);
  reasonCodes.push({ code: 'within_cap', params: { size: members.length, cap } });

  return { reasons, reasonCodes };
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/* -------------------------------------------------------------------------
 * Endpoint schemas
 * ---------------------------------------------------------------------- */

export const createGroupRequestSchema = z.object({
  studentProfileId: z.string().min(1),
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  boardId: z.string().min(1),
  topicIds: z.array(z.string().min(1)).min(1).max(20),
  areaId: z.string().min(1),
  areaFlex: z.boolean().default(false),
  /**
   * Defaulted to `no_preference` and never inferred (FR-16.6). A family that
   * says nothing has said nothing, not "anyone will do because they didn't
   * bother" and not "female, probably".
   */
  genderPreference: z.enum(GENDER_PREFERENCES).default('no_preference'),
  maxGroupSize: z.number().int().min(2).max(6),
  /** Paisa per head per month. */
  budgetMax: z.number().int().positive().nullable().default(null),
  availability: availabilitySchema,
});

export type CreateGroupRequestInput = z.infer<typeof createGroupRequestSchema>;

export const proposeGroupSchema = z.object({
  tutorId: z.string().min(1),
  memberRequestIds: z.array(z.string().min(1)).min(2).max(6),
});
