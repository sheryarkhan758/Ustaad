/**
 * Group tuition and unmet demand — the query layer for §6.23 and §6.24.
 *
 * Two things worth knowing before reading further.
 *
 * **The matcher does not query from inside itself.** `loadMatchCandidates`
 * pulls every open request that could conceivably pool, and `poolRequests` in
 * `shared/group-matching.ts` decides. That separation is what makes the solver
 * pure and therefore reproducible (FR-23.7) — a solver that issued its own
 * queries would give a different answer whenever an unrelated row changed.
 *
 * **`unmet_demand` has no identity column and no read here returns one.** Not
 * because the queries are careful, but because there is nothing to select
 * (FR-24.2). The aggregation below returns counts and nothing else, and it
 * never orders or filters by `created_at` beyond the fixed trailing window —
 * see `shared/unmet-demand.ts` for why that matters more than it looks.
 */

import { and, eq, gte, inArray, lte, or } from 'drizzle-orm';

import { fromDbBool, newId, nowIso, toDbBool } from '../../shared/db-values';
import type {
  AvailabilityWindow,
  GroupCandidate,
  GroupReasonCode,
} from '../../shared/group-matching';
import {
  DEMAND_WINDOW_DAYS,
  cohortKeyOf,
  storedPaisaToBand,
  type BudgetBandId,
  type DemandCohort,
  type UnmetDemandReason,
} from '../../shared/unmet-demand';
import type { GenderPreference } from '../../shared/search';
import {
  groupMembers,
  groupProposals,
  groupRequests,
  unmetDemand,
} from '../db/schema/matching';
import { studentProfiles } from '../db/schema/identity';
import { areaAdjacency } from '../db/schema/reference';
import type { Executor } from './_base';

/* -------------------------------------------------------------------------
 * Adjacency
 * ---------------------------------------------------------------------- */

/**
 * `areaId` → adjacent areas, read once and handed to the pure solver.
 *
 * Symmetric on read even if the seed data only stores one direction, because
 * "Clifton is next to Defence" and "Defence is next to Clifton" are the same
 * fact and a matcher that believed only one of them would pool asymmetrically.
 */
export async function loadAdjacency(db: Executor): Promise<Map<string, Set<string>>> {
  const rows = await db.select().from(areaAdjacency);
  const map = new Map<string, Set<string>>();

  const link = (from: string, to: string) => {
    const set = map.get(from) ?? new Set<string>();
    set.add(to);
    map.set(from, set);
  };

  for (const row of rows) {
    link(row.areaId, row.adjacentAreaId);
    link(row.adjacentAreaId, row.areaId);
  }
  return map;
}

/* -------------------------------------------------------------------------
 * Group requests
 * ---------------------------------------------------------------------- */

export interface GroupRequestRecord {
  id: string;
  studentProfileId: string;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds: string[];
  areaId: string;
  areaFlex: boolean;
  genderPreference: GenderPreference;
  maxGroupSize: number;
  budgetMax: number | null;
  availability: AvailabilityWindow[];
  status: string;
  expiresAt: string | null;
  createdAt: string;
}

type StoredGroupRequest = typeof groupRequests.$inferSelect;

function toGroupRequestDomain(row: StoredGroupRequest): GroupRequestRecord {
  return {
    id: row.id,
    studentProfileId: row.studentProfileId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    boardId: row.boardId,
    topicIds: JSON.parse(row.topicsJson) as string[],
    areaId: row.areaId,
    areaFlex: fromDbBool(row.areaFlex),
    genderPreference: row.genderPreference,
    maxGroupSize: row.maxGroupSize,
    budgetMax: row.budgetMax,
    availability: JSON.parse(row.availabilityJson) as AvailabilityWindow[],
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export interface CreateGroupRequestRow {
  studentProfileId: string;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds: string[];
  areaId: string;
  areaFlex: boolean;
  genderPreference: GenderPreference;
  maxGroupSize: number;
  budgetMax: number | null;
  availability: AvailabilityWindow[];
  expiresAt: string;
}

export async function insertGroupRequest(
  db: Executor,
  input: CreateGroupRequestRow,
): Promise<GroupRequestRecord> {
  const id = newId();
  await db.insert(groupRequests).values({
    id,
    studentProfileId: input.studentProfileId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    topicsJson: JSON.stringify(input.topicIds),
    areaId: input.areaId,
    areaFlex: toDbBool(input.areaFlex),
    genderPreference: input.genderPreference,
    maxGroupSize: input.maxGroupSize,
    budgetMax: input.budgetMax,
    availabilityJson: JSON.stringify(input.availability),
    status: 'open',
    expiresAt: input.expiresAt,
    createdAt: nowIso(),
  });
  return (await findGroupRequest(db, id))!;
}

export async function findGroupRequest(
  db: Executor,
  id: string,
): Promise<GroupRequestRecord | null> {
  const [row] = await db.select().from(groupRequests).where(eq(groupRequests.id, id)).limit(1);
  return row ? toGroupRequestDomain(row) : null;
}

export async function findGroupRequestsByIds(
  db: Executor,
  ids: string[],
): Promise<GroupRequestRecord[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(groupRequests).where(inArray(groupRequests.id, ids));
  return rows.map(toGroupRequestDomain);
}

/**
 * Every open request in the same (subject, level, board).
 *
 * Deliberately **not** narrowed by area, availability or gender: those are the
 * solver's job, and pre-filtering them here would move a hard constraint into
 * SQL where the explanation cannot see it. The curriculum triple is safe to
 * narrow on because it is an equality that no amount of flexibility relaxes,
 * and it is the leading edge of `idx_group_requests_match`.
 */
export async function loadMatchCandidates(
  db: Executor,
  scope: { subjectId: string; levelId: string; boardId: string },
): Promise<GroupCandidate[]> {
  const rows = await db
    .select()
    .from(groupRequests)
    .where(
      and(
        eq(groupRequests.subjectId, scope.subjectId),
        eq(groupRequests.levelId, scope.levelId),
        eq(groupRequests.boardId, scope.boardId),
        eq(groupRequests.status, 'open'),
      ),
    );

  return rows.map((row) => {
    const record = toGroupRequestDomain(row);
    return {
      requestId: record.id,
      studentProfileId: record.studentProfileId,
      subjectId: record.subjectId,
      levelId: record.levelId,
      boardId: record.boardId,
      topicIds: record.topicIds,
      areaId: record.areaId,
      areaFlex: record.areaFlex,
      genderPreference: record.genderPreference,
      maxGroupSize: record.maxGroupSize,
      budgetMax: record.budgetMax,
      availability: record.availability,
      createdAt: record.createdAt,
    };
  });
}

export async function listOpenGroupRequestsForUser(
  db: Executor,
  userId: string,
): Promise<GroupRequestRecord[]> {
  const owned = await db
    .select({ id: studentProfiles.id })
    .from(studentProfiles)
    .where(
      or(eq(studentProfiles.parentUserId, userId), eq(studentProfiles.selfUserId, userId)),
    );

  const ids = owned.map((o) => o.id);
  if (ids.length === 0) return [];

  const rows = await db
    .select()
    .from(groupRequests)
    .where(inArray(groupRequests.studentProfileId, ids));
  return rows.map(toGroupRequestDomain);
}

export async function setGroupRequestStatus(
  db: Executor,
  ids: string[],
  status: 'open' | 'proposed' | 'confirmed' | 'expired' | 'withdrawn',
): Promise<void> {
  if (ids.length === 0) return;
  await db.update(groupRequests).set({ status }).where(inArray(groupRequests.id, ids));
}

/** FR-23.10 — a partial group waits seven days, then the request expires. */
export async function expireStaleGroupRequests(db: Executor, asOf: string): Promise<string[]> {
  const stale = await db
    .select({ id: groupRequests.id })
    .from(groupRequests)
    .where(and(eq(groupRequests.status, 'open'), lte(groupRequests.expiresAt, asOf)));

  const ids = stale.map((s) => s.id);
  await setGroupRequestStatus(db, ids, 'expired');
  return ids;
}

/* -------------------------------------------------------------------------
 * Proposals and members
 * ---------------------------------------------------------------------- */

export interface GroupMemberRecord {
  proposalId: string;
  groupRequestId: string;
  studentProfileId: string;
  explanation: string[];
  /**
   * The same reasons as codes, for a client that has to say them in Urdu.
   *
   * Empty for a proposal written before codes existed — `explanation_json` held
   * a bare array then, and a row that predates a field is not a corrupt row.
   * The reader normalises both shapes rather than a migration rewriting stored
   * explanations, because an explanation is a record of what a family was told
   * at the time, and rewriting it would be editing that record.
   */
  reasonCodes: GroupReasonCode[];
  bookingId: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
}

export interface GroupProposalRecord {
  id: string;
  tutorId: string;
  subjectId: string;
  levelId: string;
  boardId: string;
  areaId: string;
  topicIds: string[];
  availability: AvailabilityWindow[];
  genderPreference: GenderPreference;
  groupKey: string;
  perHeadRate: number;
  status: string;
  tutorAcceptedAt: string | null;
  confirmedAt: string | null;
  proposedAt: string;
}

function toProposalDomain(row: typeof groupProposals.$inferSelect): GroupProposalRecord {
  return {
    id: row.id,
    tutorId: row.tutorId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    boardId: row.boardId,
    areaId: row.areaId,
    topicIds: JSON.parse(row.topicIdsJson) as string[],
    availability: JSON.parse(row.availabilityJson) as AvailabilityWindow[],
    genderPreference: row.genderPreference,
    groupKey: row.groupKey,
    perHeadRate: row.perHeadRate,
    status: row.status,
    tutorAcceptedAt: row.tutorAcceptedAt,
    confirmedAt: row.confirmedAt,
    proposedAt: row.proposedAt,
  };
}

/**
 * `explanation_json` in either shape it has ever held.
 *
 * Written as `string[]` before reason codes existed and as
 * `{ reasons, reasonCodes }` after. Both are read here so that neither a
 * migration nor a second column is needed, and — more to the point — so that a
 * proposal made last week still shows the family the sentences it was actually
 * shown when it was made.
 */
function readExplanation(json: string): { explanation: string[]; reasonCodes: GroupReasonCode[] } {
  const parsed = JSON.parse(json) as unknown;

  if (Array.isArray(parsed)) return { explanation: parsed as string[], reasonCodes: [] };

  const object = parsed as { reasons?: string[]; reasonCodes?: GroupReasonCode[] };
  return { explanation: object.reasons ?? [], reasonCodes: object.reasonCodes ?? [] };
}

function toMemberDomain(row: typeof groupMembers.$inferSelect): GroupMemberRecord {
  return {
    proposalId: row.proposalId,
    groupRequestId: row.groupRequestId,
    studentProfileId: row.studentProfileId,
    ...readExplanation(row.explanationJson),
    bookingId: row.bookingId,
    confirmedAt: row.confirmedAt,
    declinedAt: row.declinedAt,
  };
}

export async function insertProposal(
  db: Executor,
  input: Omit<GroupProposalRecord, 'status' | 'tutorAcceptedAt' | 'confirmedAt' | 'proposedAt'> & {
    members: {
      groupRequestId: string;
      studentProfileId: string;
      explanation: string[];
      reasonCodes: GroupReasonCode[];
    }[];
  },
): Promise<void> {
  await db.insert(groupProposals).values({
    id: input.id,
    tutorId: input.tutorId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    areaId: input.areaId,
    topicIdsJson: JSON.stringify(input.topicIds),
    availabilityJson: JSON.stringify(input.availability),
    genderPreference: input.genderPreference,
    groupKey: input.groupKey,
    perHeadRate: input.perHeadRate,
    status: 'proposed',
    proposedAt: nowIso(),
    createdAt: nowIso(),
  });

  for (const member of input.members) {
    await db.insert(groupMembers).values({
      proposalId: input.id,
      groupRequestId: member.groupRequestId,
      studentProfileId: member.studentProfileId,
      explanationJson: JSON.stringify({
        reasons: member.explanation,
        reasonCodes: member.reasonCodes,
      }),
      bookingId: null,
      confirmedAt: null,
      declinedAt: null,
    });
  }
}

export async function findProposal(
  db: Executor,
  id: string,
): Promise<GroupProposalRecord | null> {
  const [row] = await db.select().from(groupProposals).where(eq(groupProposals.id, id)).limit(1);
  return row ? toProposalDomain(row) : null;
}

export async function listProposalMembers(
  db: Executor,
  proposalId: string,
): Promise<GroupMemberRecord[]> {
  const rows = await db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.proposalId, proposalId));
  // Stable order, so a response never varies between two identical requests.
  return rows.map(toMemberDomain).sort((a, b) => a.groupRequestId.localeCompare(b.groupRequestId));
}

export async function listProposalsForTutor(
  db: Executor,
  tutorId: string,
): Promise<GroupProposalRecord[]> {
  const rows = await db.select().from(groupProposals).where(eq(groupProposals.tutorId, tutorId));
  return rows.map(toProposalDomain).sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

export async function listProposalsForRequest(
  db: Executor,
  groupRequestId: string,
): Promise<GroupProposalRecord[]> {
  const memberships = await db
    .select({ proposalId: groupMembers.proposalId })
    .from(groupMembers)
    .where(eq(groupMembers.groupRequestId, groupRequestId));

  const ids = memberships.map((m) => m.proposalId);
  if (ids.length === 0) return [];

  const rows = await db.select().from(groupProposals).where(inArray(groupProposals.id, ids));
  return rows.map(toProposalDomain).sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

export async function setMemberDecision(
  db: Executor,
  input: { proposalId: string; groupRequestId: string; decision: 'confirm' | 'decline'; at: string },
): Promise<void> {
  await db
    .update(groupMembers)
    .set(
      input.decision === 'confirm'
        ? { confirmedAt: input.at, declinedAt: null }
        : { declinedAt: input.at, confirmedAt: null },
    )
    .where(
      and(
        eq(groupMembers.proposalId, input.proposalId),
        eq(groupMembers.groupRequestId, input.groupRequestId),
      ),
    );
}

export async function setMemberBooking(
  db: Executor,
  input: { proposalId: string; groupRequestId: string; bookingId: string | null },
): Promise<void> {
  await db
    .update(groupMembers)
    .set({ bookingId: input.bookingId })
    .where(
      and(
        eq(groupMembers.proposalId, input.proposalId),
        eq(groupMembers.groupRequestId, input.groupRequestId),
      ),
    );
}

export async function setProposalFields(
  db: Executor,
  id: string,
  fields: Partial<{
    status: 'proposed' | 'accepted' | 'declined' | 'confirmed' | 'expired';
    tutorAcceptedAt: string | null;
    confirmedAt: string | null;
  }>,
): Promise<void> {
  await db.update(groupProposals).set(fields).where(eq(groupProposals.id, id));
}

/**
 * First name and area only — FR-23.8.
 *
 * Until a group confirms, a participant may learn that they would be studying
 * with "Ayesha, from Clifton" and nothing further. The truncation happens here,
 * in the query layer, so no handler can widen it by forgetting to: the full
 * name never leaves this function.
 */
export async function listMemberIdentities(
  db: Executor,
  studentProfileIds: string[],
  options: { full: boolean },
): Promise<{ studentProfileId: string; firstName: string; fullName?: string }[]> {
  if (studentProfileIds.length === 0) return [];

  const rows = await db
    .select({ id: studentProfiles.id, name: studentProfiles.name })
    .from(studentProfiles)
    .where(inArray(studentProfiles.id, studentProfileIds));

  return rows
    .map((row) => ({
      studentProfileId: row.id,
      // Whitespace split on the stored name. Never transliterated, never
      // normalised — an Urdu-script name splits the same way (§2.10).
      firstName: row.name.trim().split(/\s+/)[0] ?? row.name,
      ...(options.full ? { fullName: row.name } : {}),
    }))
    .sort((a, b) => a.studentProfileId.localeCompare(b.studentProfileId));
}

/* -------------------------------------------------------------------------
 * Unmet demand — §6.24
 * ---------------------------------------------------------------------- */

export interface RecordUnmetDemandInput {
  subjectId: string;
  topicIds: string[];
  levelId: string | null;
  boardId: string | null;
  areaId: string | null;
  genderPreference: GenderPreference;
  /** Already banded by the caller. This layer never sees a stated figure. */
  bandedBudgetPaisa: number | null;
  reason: UnmetDemandReason;
}

export async function insertUnmetDemand(
  db: Executor,
  input: RecordUnmetDemandInput,
): Promise<string> {
  const id = newId();
  await db.insert(unmetDemand).values({
    id,
    subjectId: input.subjectId,
    topicIdsJson: JSON.stringify(input.topicIds),
    levelId: input.levelId,
    boardId: input.boardId,
    areaId: input.areaId,
    genderPreference: input.genderPreference,
    budgetMax: input.bandedBudgetPaisa,
    reason: input.reason,
    createdAt: nowIso(),
  });
  return id;
}

/**
 * Aggregate the trailing window into cohorts.
 *
 * The window bound is computed by the caller and passed in, so this stays a
 * pure read. **Nothing here reads `created_at` except that one `>=`** — no
 * ordering by it, no min, no max, no bucketing by day. A board that told you
 * when the records arrived would tell you which one was yours.
 *
 * Suppression is applied afterwards, by `suppressSmallCohorts`, so the rule
 * lives in one pure function that a test can exercise directly.
 */
export async function aggregateDemandCohorts(
  db: Executor,
  input: {
    since: string;
    filters: { subjectId?: string; areaId?: string; levelId?: string; genderPreference?: GenderPreference };
  },
): Promise<{ cohorts: DemandCohort[]; totalRecordsInWindow: number }> {
  const conditions = [gte(unmetDemand.createdAt, input.since)];
  if (input.filters.subjectId) conditions.push(eq(unmetDemand.subjectId, input.filters.subjectId));
  if (input.filters.areaId) conditions.push(eq(unmetDemand.areaId, input.filters.areaId));
  if (input.filters.levelId) conditions.push(eq(unmetDemand.levelId, input.filters.levelId));
  if (input.filters.genderPreference) {
    conditions.push(eq(unmetDemand.genderPreference, input.filters.genderPreference));
  }

  // No identity column exists to select, so this cannot return one. The columns
  // are named individually rather than `select()` so that stays true if the
  // table ever grows one by mistake — it would fail review here, loudly.
  const rows = await db
    .select({
      subjectId: unmetDemand.subjectId,
      topicIdsJson: unmetDemand.topicIdsJson,
      levelId: unmetDemand.levelId,
      boardId: unmetDemand.boardId,
      areaId: unmetDemand.areaId,
      genderPreference: unmetDemand.genderPreference,
      budgetMax: unmetDemand.budgetMax,
      reason: unmetDemand.reason,
    })
    .from(unmetDemand)
    .where(and(...conditions));

  const byCohort = new Map<string, DemandCohort & { topicCounts: Map<string, number>; bandCounts: Map<string, number>; reasonCounts: Map<string, number> }>();

  for (const row of rows) {
    const key = {
      subjectId: row.subjectId,
      levelId: row.levelId,
      boardId: row.boardId,
      areaId: row.areaId,
      genderPreference: row.genderPreference,
    };
    const cohortKey = cohortKeyOf(key);

    let cohort = byCohort.get(cohortKey);
    if (!cohort) {
      cohort = {
        ...key,
        cohortKey,
        count: 0,
        topics: [],
        budgetBands: [],
        reasons: [],
        topicCounts: new Map(),
        bandCounts: new Map(),
        reasonCounts: new Map(),
      };
      byCohort.set(cohortKey, cohort);
    }

    cohort.count += 1;

    for (const topicId of new Set(JSON.parse(row.topicIdsJson) as string[])) {
      cohort.topicCounts.set(topicId, (cohort.topicCounts.get(topicId) ?? 0) + 1);
    }

    const band = storedPaisaToBand(row.budgetMax);
    if (band) cohort.bandCounts.set(band, (cohort.bandCounts.get(band) ?? 0) + 1);

    cohort.reasonCounts.set(row.reason, (cohort.reasonCounts.get(row.reason) ?? 0) + 1);
  }

  const cohorts: DemandCohort[] = [...byCohort.values()].map((c) => ({
    subjectId: c.subjectId,
    levelId: c.levelId,
    boardId: c.boardId,
    areaId: c.areaId,
    genderPreference: c.genderPreference,
    cohortKey: c.cohortKey,
    count: c.count,
    topics: [...c.topicCounts.entries()].map(([topicId, count]) => ({ topicId, count })),
    budgetBands: [...c.bandCounts.keys()].sort() as BudgetBandId[],
    reasons: [...c.reasonCounts.entries()].map(([reason, count]) => ({
      reason: reason as UnmetDemandReason,
      count,
    })),
  }));

  return { cohorts, totalRecordsInWindow: rows.length };
}

/** The fixed trailing window bound. A constant, never a caller's choice. */
export function demandWindowStart(now: Date): string {
  return new Date(now.getTime() - DEMAND_WINDOW_DAYS * 86_400_000).toISOString();
}
