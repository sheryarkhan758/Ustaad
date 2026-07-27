/**
 * Group tuition — §6.23.
 *
 * Orchestration only. The decision of *who pools with whom* is made by
 * `poolRequests` in `shared/group-matching.ts`, which is pure; this module
 * loads its inputs, persists its output and turns a confirmed proposal into
 * linked bookings.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * How "no orphan bookings" is guaranteed without a transaction
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CLAUDE.md §2.1 forbids `db.transaction()` outside `server/db/index.ts`, and
 * the reason is not stylistic: better-sqlite3's transaction callback runs
 * **synchronously**, so any `await` inside it escapes the transaction and
 * commits outside it, while postgres-js's callback is asynchronous and behaves
 * as you would expect. A helper spanning both would silently provide atomicity
 * on one engine and the appearance of it on the other, which is worse than
 * having none.
 *
 * So `formGroup` gets the same guarantee a different way, by making one column
 * the commit point:
 *
 *  1. Every member's booking is written first, each carrying
 *     `groupId = proposalId`. At this moment the proposal is still `accepted`,
 *     not `confirmed`.
 *  2. **A group only exists when `group_proposals.confirmed_at` is set.** That
 *     is one `UPDATE` of one row — atomic on both engines with no transaction
 *     involved. Nothing in the system treats a set of bookings as a group
 *     except by resolving them through a confirmed proposal.
 *  3. If any booking insert fails, the ones already written are deleted and the
 *     proposal stays `accepted`. Nobody observed a partial group, because a
 *     partial group is not reachable through the only path that reads one.
 *
 * The residual failure mode is a crash between step 1 and step 2, which leaves
 * orphan `requested` bookings that no group points at. `reconcileAbandonedGroup`
 * clears them, and the sweep is safe to re-run. Compare the alternative: a
 * confirmed proposal whose members have no bookings would show three families a
 * class that does not exist.
 */

import { and, eq } from 'drizzle-orm';

import { newId, nowIso, toDbBool } from '../../shared/db-values';
import {
  poolRequests,
  type AdjacencyMap,
  type CandidateGroup,
  type CreateGroupRequestInput,
} from '../../shared/group-matching';
import { bookings } from '../db/schema/booking';
import { tutorRates } from '../db/schema/tutor';
import {
  expireStaleGroupRequests,
  findGroupRequest,
  findGroupRequestsByIds,
  findProposal,
  insertGroupRequest,
  insertProposal,
  listMemberIdentities,
  listProposalMembers,
  loadAdjacency,
  loadMatchCandidates,
  setGroupRequestStatus,
  setMemberBooking,
  setMemberDecision,
  setProposalFields,
  type GroupProposalRecord,
  type GroupRequestRecord,
} from '../repositories/groups';
import { isTutorSearchable } from '../repositories/search';
import { findSafetyConstraints, findTutorProfile } from '../repositories/tutors';
import type { Executor } from '../repositories/_base';
import { studentProfiles } from '../db/schema/identity';

/** FR-23.10 — a partial group waits a week, then the request expires. */
export const GROUP_REQUEST_TTL_DAYS = 7;

export class GroupError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GroupError';
    this.status = status;
    this.code = code;
  }
}

/* -------------------------------------------------------------------------
 * Opting in — FR-23.1
 * ---------------------------------------------------------------------- */

/**
 * Create a request. **Opt-in only.**
 *
 * Nothing anywhere else creates one of these. A family that booked one-to-one
 * is not quietly entered into the pool because the platform thinks they would
 * save money — sharing a tutor means a stranger's child in your house every
 * week, and that is not a default anyone gets to choose on your behalf.
 */
export async function createGroupRequest(
  db: Executor,
  input: CreateGroupRequestInput & { requestedByUserId: string },
  now: Date = new Date(),
): Promise<GroupRequestRecord> {
  const [student] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.id, input.studentProfileId))
    .limit(1);

  // A minor's profile is acted on by their parent; an adult student acts for
  // themselves. Nobody else, and a stranger's id is "not found" rather than
  // "forbidden" so profile ids cannot be enumerated (SEC-1, SEC-2).
  const mayAct =
    student !== undefined &&
    (student.parentUserId === input.requestedByUserId ||
      student.selfUserId === input.requestedByUserId);

  if (!mayAct) {
    throw new GroupError(404, 'student_not_found', 'No such student profile.');
  }

  return insertGroupRequest(db, {
    studentProfileId: input.studentProfileId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    topicIds: input.topicIds,
    areaId: input.areaId,
    areaFlex: input.areaFlex,
    genderPreference: input.genderPreference,
    maxGroupSize: input.maxGroupSize,
    budgetMax: input.budgetMax,
    availability: input.availability,
    expiresAt: new Date(now.getTime() + GROUP_REQUEST_TTL_DAYS * 86_400_000).toISOString(),
  });
}

export async function withdrawGroupRequest(
  db: Executor,
  input: { requestId: string; userId: string },
): Promise<void> {
  const request = await findGroupRequest(db, input.requestId);
  if (!request) throw new GroupError(404, 'request_not_found', 'No such group request.');
  await assertOwnsStudent(db, request.studentProfileId, input.userId);
  await setGroupRequestStatus(db, [input.requestId], 'withdrawn');
}

async function assertOwnsStudent(
  db: Executor,
  studentProfileId: string,
  userId: string,
): Promise<void> {
  const [student] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);

  if (!student || (student.parentUserId !== userId && student.selfUserId !== userId)) {
    throw new GroupError(404, 'request_not_found', 'No such group request.');
  }
}

/* -------------------------------------------------------------------------
 * Matching — FR-23.2, FR-23.7
 * ---------------------------------------------------------------------- */

export interface MatchPreview {
  /** The group this request landed in, or null when it pooled with nobody. */
  group: CandidateGroup | null;
  /** Every group the sweep produced. Ordered deterministically. */
  allGroups: CandidateGroup[];
  /** First name and area only, until the group confirms (FR-23.8). */
  members: { studentProfileId: string; firstName: string; areaId: string }[];
}

/**
 * Run the matcher over the pool this request belongs to.
 *
 * Reads nothing that varies within a request: the candidate set, the adjacency
 * table, and then a pure function. Called twice in a row with no writes in
 * between, it returns the same answer — which is the property the "same input
 * yields the same grouping" test pins down.
 */
export async function previewMatches(
  db: Executor,
  requestId: string,
): Promise<MatchPreview> {
  const request = await findGroupRequest(db, requestId);
  if (!request) throw new GroupError(404, 'request_not_found', 'No such group request.');

  const candidates = await loadMatchCandidates(db, {
    subjectId: request.subjectId,
    levelId: request.levelId,
    boardId: request.boardId,
  });

  const adjacency: AdjacencyMap = await loadAdjacency(db);
  const { groups } = poolRequests(candidates, adjacency);
  const group = groups.find((g) => g.memberRequestIds.includes(requestId)) ?? null;

  const members = group
    ? await describeMembers(db, group, { full: false })
    : [];

  return { group, allGroups: groups, members };
}

async function describeMembers(
  db: Executor,
  group: CandidateGroup,
  options: { full: boolean },
): Promise<{ studentProfileId: string; firstName: string; areaId: string }[]> {
  const requests = await findGroupRequestsByIds(db, group.memberRequestIds);
  const areaOf = new Map(requests.map((r) => [r.studentProfileId, r.areaId]));

  const identities = await listMemberIdentities(
    db,
    requests.map((r) => r.studentProfileId),
    options,
  );

  return identities.map((i) => ({
    studentProfileId: i.studentProfileId,
    firstName: i.firstName,
    areaId: areaOf.get(i.studentProfileId) ?? '',
  }));
}

/* -------------------------------------------------------------------------
 * Proposing to a tutor — FR-23.3, FR-23.5
 * ---------------------------------------------------------------------- */

/**
 * The tutor's own group price, per head per month (FR-23.3).
 *
 * Read from `tutor_rates`, never supplied by the caller. A per-head rate the
 * requesting family could name would let a family propose a group at a price
 * the tutor never agreed to, and the tutor would find out by receiving it.
 */
async function resolveGroupRate(
  db: Executor,
  input: { tutorId: string; subjectId: string; levelId: string },
): Promise<number> {
  const rows = await db
    .select()
    .from(tutorRates)
    .where(and(eq(tutorRates.tutorId, input.tutorId), eq(tutorRates.rateType, 'group_monthly')));

  // A rate naming this subject and level beats a blanket one.
  const ranked = [...rows].sort((a, b) => specificity(b) - specificity(a) || a.id.localeCompare(b.id));
  const match = ranked.find(
    (r) =>
      (r.subjectId === null || r.subjectId === input.subjectId) &&
      (r.levelId === null || r.levelId === input.levelId),
  );

  if (!match || match.perHeadAmount === null) {
    throw new GroupError(
      409,
      'no_group_rate',
      'This tutor has not published a group rate, so a per-head price cannot be shown.',
    );
  }
  return match.perHeadAmount;
}

function specificity(rate: typeof tutorRates.$inferSelect): number {
  return (rate.subjectId ? 2 : 0) + (rate.levelId ? 1 : 0);
}

export interface ProposalView {
  proposal: GroupProposalRecord;
  members: {
    groupRequestId: string;
    studentProfileId: string;
    firstName: string;
    areaId: string;
    explanation: string[];
    confirmed: boolean;
    declined: boolean;
  }[];
  /** Paisa per head per month. */
  perHeadRate: number;
  allConfirmed: boolean;
}

/**
 * Send a candidate group to a tutor.
 *
 * The group is **re-derived** from the matcher rather than trusted from the
 * request body. A caller naming an arbitrary set of request ids would otherwise
 * be able to assemble a group the constraints forbid — a male tutor for a
 * family that required a female one, say — by simply not asking the solver.
 */
export async function proposeGroupToTutor(
  db: Executor,
  input: { tutorId: string; memberRequestIds: string[]; requestedByUserId: string },
): Promise<ProposalView> {
  const requested = [...input.memberRequestIds].sort();
  const groupKey = requested.join('|');

  const requests = await findGroupRequestsByIds(db, requested);
  if (requests.length !== requested.length) {
    throw new GroupError(404, 'request_not_found', 'One of those group requests does not exist.');
  }

  // The caller must be in the group they are proposing.
  const ownsOne = await Promise.all(
    requests.map((r) =>
      assertOwnsStudent(db, r.studentProfileId, input.requestedByUserId).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (!ownsOne.some(Boolean)) {
    throw new GroupError(403, 'not_a_member', 'You are not part of that group.');
  }

  const [seed] = requests as [GroupRequestRecord, ...GroupRequestRecord[]];
  const candidates = await loadMatchCandidates(db, {
    subjectId: seed.subjectId,
    levelId: seed.levelId,
    boardId: seed.boardId,
  });
  const { groups } = poolRequests(candidates, await loadAdjacency(db));

  const group = groups.find((g) => g.groupKey === groupKey);
  if (!group) {
    throw new GroupError(
      409,
      'not_a_valid_group',
      'Those requests do not form a group under the current constraints.',
    );
  }

  /* --- The tutor must be one this group could actually have (SEC-19) ----- */

  if (!(await isTutorSearchable(db, input.tutorId))) {
    throw new GroupError(404, 'tutor_not_found', 'No such tutor.');
  }

  const tutor = await findTutorProfile(db, input.tutorId);
  if (!tutor) throw new GroupError(404, 'tutor_not_found', 'No such tutor.');

  // The group's gender requirement is a hard exclusion, exactly as it is in
  // search (§2.4). It is checked here, in code, and not left to the family.
  const required =
    group.genderPreference === 'female_only'
      ? 'female'
      : group.genderPreference === 'male_only'
        ? 'male'
        : null;

  if (required !== null && tutor.gender !== required) {
    throw new GroupError(
      409,
      'tutor_gender_mismatch',
      'This group requires a tutor of a different gender.',
    );
  }

  // And the tutor's own reciprocal constraints (SEC-19, FR-29.10).
  const safety = await findSafetyConstraints(db, input.tutorId);
  if (safety?.femaleStudentsOnly) {
    const genders = await db
      .select({ id: studentProfiles.id, gender: studentProfiles.gender })
      .from(studentProfiles);
    const inGroup = new Set(requests.map((r) => r.studentProfileId));
    const anyNonFemale = genders.some((g) => inGroup.has(g.id) && g.gender !== 'female');
    if (anyNonFemale) {
      throw new GroupError(
        409,
        'tutor_constraints_not_met',
        'This tutor teaches female students only, and the group is not all female.',
      );
    }
  }

  const restricted = new Set(safety?.restrictedAreaIds ?? []);
  if (group.areaIds.some((a) => restricted.has(a))) {
    throw new GroupError(
      409,
      'tutor_constraints_not_met',
      'This tutor does not travel to one of the areas in this group.',
    );
  }

  /* --- The price, from the tutor's own rate table (FR-23.3) -------------- */

  const perHeadRate = await resolveGroupRate(db, {
    tutorId: input.tutorId,
    subjectId: group.subjectId,
    levelId: group.levelId,
  });

  if (group.perHeadBudgetCeiling !== null && perHeadRate > group.perHeadBudgetCeiling) {
    throw new GroupError(
      409,
      'above_budget_ceiling',
      "This tutor's group rate is above the lowest budget stated in the group.",
    );
  }

  const proposalId = newId();
  const explanationOf = new Map(group.explanations.map((e) => [e.requestId, e.reasons]));

  await insertProposal(db, {
    id: proposalId,
    tutorId: input.tutorId,
    subjectId: group.subjectId,
    levelId: group.levelId,
    boardId: group.boardId,
    areaId: group.areaId,
    topicIds: group.sharedTopicIds,
    availability: group.sharedAvailability,
    genderPreference: group.genderPreference,
    groupKey: group.groupKey,
    perHeadRate,
    members: requests.map((r) => ({
      groupRequestId: r.id,
      studentProfileId: r.studentProfileId,
      explanation: explanationOf.get(r.id) ?? [],
    })),
  });

  await setGroupRequestStatus(db, group.memberRequestIds, 'proposed');

  return viewProposal(db, proposalId, { full: false });
}

export async function viewProposal(
  db: Executor,
  proposalId: string,
  options: { full: boolean },
): Promise<ProposalView> {
  const proposal = await findProposal(db, proposalId);
  if (!proposal) throw new GroupError(404, 'proposal_not_found', 'No such group proposal.');

  const members = await listProposalMembers(db, proposalId);
  const requests = await findGroupRequestsByIds(
    db,
    members.map((m) => m.groupRequestId),
  );
  const areaOf = new Map(requests.map((r) => [r.id, r.areaId]));

  // FR-23.8: full names only once the group has actually formed.
  const identities = await listMemberIdentities(
    db,
    members.map((m) => m.studentProfileId),
    { full: options.full && proposal.confirmedAt !== null },
  );
  const nameOf = new Map(identities.map((i) => [i.studentProfileId, i]));

  return {
    proposal,
    perHeadRate: proposal.perHeadRate,
    allConfirmed: members.every((m) => m.confirmedAt !== null),
    members: members.map((m) => ({
      groupRequestId: m.groupRequestId,
      studentProfileId: m.studentProfileId,
      firstName: nameOf.get(m.studentProfileId)?.fullName ?? nameOf.get(m.studentProfileId)?.firstName ?? '',
      areaId: areaOf.get(m.groupRequestId) ?? '',
      explanation: m.explanation,
      confirmed: m.confirmedAt !== null,
      declined: m.declinedAt !== null,
    })),
  };
}

/* -------------------------------------------------------------------------
 * Confirmation, from both sides — FR-23.4, FR-23.5
 * ---------------------------------------------------------------------- */

export interface FormationResult extends ProposalView {
  /** Set when this call was the one that formed the group. */
  groupId: string | null;
  bookingIds: string[];
}

/** A participant confirms (FR-23.4), or declines and dissolves the proposal. */
export async function respondAsMember(
  db: Executor,
  input: {
    proposalId: string;
    groupRequestId: string;
    userId: string;
    decision: 'confirm' | 'decline';
  },
  now: Date = new Date(),
): Promise<FormationResult> {
  const proposal = await findProposal(db, input.proposalId);
  if (!proposal) throw new GroupError(404, 'proposal_not_found', 'No such group proposal.');
  if (proposal.confirmedAt !== null) {
    throw new GroupError(409, 'already_formed', 'This group has already formed.');
  }
  if (proposal.status === 'declined' || proposal.status === 'expired') {
    throw new GroupError(409, 'proposal_closed', 'This proposal is no longer open.');
  }

  const members = await listProposalMembers(db, input.proposalId);
  const member = members.find((m) => m.groupRequestId === input.groupRequestId);
  if (!member) throw new GroupError(404, 'not_a_member', 'You are not part of that group.');

  await assertOwnsStudent(db, member.studentProfileId, input.userId);
  await setMemberDecision(db, {
    proposalId: input.proposalId,
    groupRequestId: input.groupRequestId,
    decision: input.decision,
    at: now.toISOString(),
  });

  if (input.decision === 'decline') {
    // One refusal ends the proposal. A group of two out of three is a different
    // group at a different per-head price, and it has to be offered as one.
    await setProposalFields(db, input.proposalId, { status: 'declined' });
    await setGroupRequestStatus(
      db,
      members.filter((m) => m.groupRequestId !== input.groupRequestId).map((m) => m.groupRequestId),
      'open',
    );
    return { ...(await viewProposal(db, input.proposalId, { full: false })), groupId: null, bookingIds: [] };
  }

  return tryFormGroup(db, input.proposalId, now);
}

/** The tutor accepts or declines the group **as a unit** (FR-23.5). */
export async function respondAsTutor(
  db: Executor,
  input: { proposalId: string; tutorId: string; decision: 'accept' | 'decline' },
  now: Date = new Date(),
): Promise<FormationResult> {
  const proposal = await findProposal(db, input.proposalId);
  if (!proposal) throw new GroupError(404, 'proposal_not_found', 'No such group proposal.');
  if (proposal.tutorId !== input.tutorId) {
    throw new GroupError(404, 'proposal_not_found', 'No such group proposal.');
  }
  if (proposal.confirmedAt !== null) {
    throw new GroupError(409, 'already_formed', 'This group has already formed.');
  }

  if (input.decision === 'decline') {
    await setProposalFields(db, input.proposalId, { status: 'declined' });
    const members = await listProposalMembers(db, input.proposalId);
    await setGroupRequestStatus(db, members.map((m) => m.groupRequestId), 'open');
    return { ...(await viewProposal(db, input.proposalId, { full: false })), groupId: null, bookingIds: [] };
  }

  await setProposalFields(db, input.proposalId, {
    status: 'accepted',
    tutorAcceptedAt: now.toISOString(),
  });

  return tryFormGroup(db, input.proposalId, now);
}

/**
 * Form the group if — and only if — both sides have said yes.
 *
 * Idempotent by construction: it returns early unless the tutor has accepted
 * and every member has confirmed, and the `confirmedAt` check at the top means
 * a second call after formation does nothing. Whichever side lands last runs
 * this to completion; the other's call was a no-op.
 */
async function tryFormGroup(
  db: Executor,
  proposalId: string,
  now: Date,
): Promise<FormationResult> {
  const proposal = await findProposal(db, proposalId);
  if (!proposal) throw new GroupError(404, 'proposal_not_found', 'No such group proposal.');

  const members = await listProposalMembers(db, proposalId);
  const ready =
    proposal.confirmedAt === null &&
    proposal.tutorAcceptedAt !== null &&
    members.length > 0 &&
    members.every((m) => m.confirmedAt !== null && m.declinedAt === null);

  if (!ready) {
    return { ...(await viewProposal(db, proposalId, { full: false })), groupId: null, bookingIds: [] };
  }

  const requests = await findGroupRequestsByIds(db, members.map((m) => m.groupRequestId));
  const requestOf = new Map(requests.map((r) => [r.id, r]));

  const slot = firstSlot(proposal.availability, now);
  const written: string[] = [];

  /* --- 1. Each member's own booking, linked by groupId (FR-23.6) --------- */

  try {
    for (const member of members) {
      const request = requestOf.get(member.groupRequestId);
      if (!request) throw new GroupError(404, 'request_not_found', 'A member request vanished.');

      const owner = await ownerUserId(db, member.studentProfileId);
      const bookingId = newId();

      await db.insert(bookings).values({
        id: bookingId,
        tutorId: proposal.tutorId,
        studentProfileId: member.studentProfileId,
        requestedByUserId: owner,
        engagementType: 'group',
        subjectId: proposal.subjectId,
        levelId: proposal.levelId,
        boardId: proposal.boardId,
        topicIdsJson: JSON.stringify(proposal.topicIds),
        mode: 'home',
        areaId: request.areaId,
        slotStart: slot.start,
        slotEnd: slot.end,
        // Paisa per head per month. Frozen here, immutable afterwards
        // (FR-31.1) — and recorded, never charged (§2.6).
        agreedRate: proposal.perHeadRate,
        rateType: 'group_monthly',
        isTrial: toDbBool(false),
        // Every member keeps an individual booking for reviews and progress
        // (FR-23.6); the shared identifier is what makes them one class.
        groupId: proposalId,
        status: 'confirmed',
        statusChangedBy: 'tutor',
        statusChangedAt: now.toISOString(),
        requestedAt: now.toISOString(),
        respondedAt: now.toISOString(),
        confirmedAt: now.toISOString(),
        createdAt: nowIso(),
      });

      written.push(bookingId);
      await setMemberBooking(db, {
        proposalId,
        groupRequestId: member.groupRequestId,
        bookingId,
      });
    }
  } catch (error) {
    // Undo. Nothing observed these: the proposal is not `confirmed`, so no
    // reader treats them as a group (see the header).
    await reconcileAbandonedGroup(db, proposalId);
    throw error;
  }

  /* --- 2. The commit point. One row, one column, both engines. ----------- */

  await setProposalFields(db, proposalId, {
    status: 'confirmed',
    confirmedAt: now.toISOString(),
  });
  await setGroupRequestStatus(db, members.map((m) => m.groupRequestId), 'confirmed');

  return {
    ...(await viewProposal(db, proposalId, { full: true })),
    groupId: proposalId,
    bookingIds: written.sort(),
  };
}

/**
 * Delete bookings written for a proposal that never reached `confirmed`.
 *
 * Safe to run at any time and safe to re-run: a confirmed proposal is left
 * alone, so this can only ever remove rows that no group points at.
 */
export async function reconcileAbandonedGroup(db: Executor, proposalId: string): Promise<number> {
  const proposal = await findProposal(db, proposalId);
  if (proposal?.confirmedAt) return 0;

  const orphans = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.groupId, proposalId));

  for (const orphan of orphans) {
    await db.delete(bookings).where(eq(bookings.id, orphan.id));
  }

  for (const member of await listProposalMembers(db, proposalId)) {
    if (member.bookingId) {
      await setMemberBooking(db, {
        proposalId,
        groupRequestId: member.groupRequestId,
        bookingId: null,
      });
    }
  }

  return orphans.length;
}

async function ownerUserId(db: Executor, studentProfileId: string): Promise<string> {
  const [student] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);

  // A minor has no account, so the parent is the requester. There is no third
  // possibility: the schema requires exactly one of the two (SEC-1).
  const owner = student?.parentUserId ?? student?.selfUserId;
  if (!owner) {
    throw new GroupError(409, 'no_account_for_student', 'That student profile has no account behind it.');
  }
  return owner;
}

/**
 * The first session, from the group's shared weekly window.
 *
 * Computed in TypeScript from an `HH:MM` window and a weekday, never by a
 * database date function (§2.1). The group recurs weekly from here; this row is
 * the first instance and what the progress ledger hangs off.
 */
function firstSlot(
  availability: { weekday: number; startTime: string; endTime: string }[],
  now: Date,
): { start: string; end: string } {
  const [window] = availability;
  if (!window) {
    throw new GroupError(409, 'no_shared_window', 'This group has no shared weekly window.');
  }

  const start = new Date(now.getTime());
  start.setUTCHours(0, 0, 0, 0);
  const delta = (window.weekday - start.getUTCDay() + 7) % 7 || 7;
  start.setUTCDate(start.getUTCDate() + delta);

  const at = (hhmm: string): string => {
    const when = new Date(start.getTime());
    when.setUTCHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
    return when.toISOString();
  };

  return { start: at(window.startTime), end: at(window.endTime) };
}

/* -------------------------------------------------------------------------
 * Expiry — FR-23.10
 * ---------------------------------------------------------------------- */

export async function expireGroupRequests(
  db: Executor,
  now: Date = new Date(),
): Promise<{ expired: string[] }> {
  return { expired: await expireStaleGroupRequests(db, now.toISOString()) };
}
