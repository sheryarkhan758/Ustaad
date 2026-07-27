/**
 * Persistence for the tutor onboarding aggregate — claims, rates, availability.
 *
 * Kept beside `tutors.ts` rather than inside it because these three are the
 * write-heavy part of onboarding and each carries a rule worth stating at the
 * top of its own section.
 *
 * Everything crossing this boundary is a domain object: booleans are booleans,
 * JSON is arrays, timestamps are `Date`.
 */

import { and, eq } from 'drizzle-orm';

import {
  fromDbBool,
  fromDbJsonArray,
  fromDbTimestamp,
  newId,
  nowIso,
  toDbBool,
  toDbJson,
} from '../../shared/db-values';
import type { RateType, TeachingMode } from '../../shared/rates';
import {
  TUTOR_SETTABLE_CLAIM_STATUS,
  tutorAvailability,
  tutorRates,
  tutorSubjectClaims,
} from '../db/schema/tutor';
import type { ClaimStatus } from '../db/schema/tutor';
import { type Executor, NotFoundError } from './_base';

/* =========================================================================
 * Subject claims — §6.4, FR-4.4
 * ====================================================================== */

export interface SubjectClaimRecord {
  id: string;
  tutorId: string;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds: string[];
  /** `asserted` until Agent 2 tests it. Never set by a tutor-facing write. */
  claimStatus: ClaimStatus;
  createdAt: Date;
}

type StoredClaim = typeof tutorSubjectClaims.$inferSelect;

function toClaimDomain(row: StoredClaim): SubjectClaimRecord {
  return {
    id: row.id,
    tutorId: row.tutorId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    boardId: row.boardId,
    topicIds: fromDbJsonArray(row.topicIdsJson),
    claimStatus: row.claimStatus,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

/**
 * Record a claim.
 *
 * **`claimStatus` is not a parameter.** It is written as `asserted` and there
 * is no argument through which a caller could ask for anything else. A tutor
 * saying they can teach Organic Chemistry is the input to an assessment, not
 * the result of one (§2.2, §6.11).
 */
export async function insertSubjectClaim(
  db: Executor,
  input: {
    tutorId: string;
    subjectId: string;
    levelId: string;
    boardId: string;
    topicIds: string[];
  },
): Promise<SubjectClaimRecord> {
  const id = newId();
  await db.insert(tutorSubjectClaims).values({
    id,
    tutorId: input.tutorId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    topicIdsJson: toDbJson(input.topicIds) ?? '[]',
    claimStatus: TUTOR_SETTABLE_CLAIM_STATUS,
    createdAt: nowIso(),
  });
  return getSubjectClaimOrThrow(db, id);
}

/**
 * Amend a claim.
 *
 * Editing the topics resets the claim to `asserted`: a verdict was reached
 * about a particular set of topics, and silently carrying a `verified` badge
 * onto a set the assessment never covered would make the badge a lie.
 */
export async function updateSubjectClaim(
  db: Executor,
  id: string,
  input: { subjectId?: string; levelId?: string; boardId?: string; topicIds?: string[] },
): Promise<SubjectClaimRecord> {
  const values: Record<string, unknown> = { claimStatus: TUTOR_SETTABLE_CLAIM_STATUS };
  if (input.subjectId !== undefined) values.subjectId = input.subjectId;
  if (input.levelId !== undefined) values.levelId = input.levelId;
  if (input.boardId !== undefined) values.boardId = input.boardId;
  if (input.topicIds !== undefined) values.topicIdsJson = toDbJson(input.topicIds) ?? '[]';

  await db.update(tutorSubjectClaims).set(values).where(eq(tutorSubjectClaims.id, id));
  return getSubjectClaimOrThrow(db, id);
}

export async function findSubjectClaim(
  db: Executor,
  id: string,
): Promise<SubjectClaimRecord | null> {
  const rows = await db
    .select()
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.id, id))
    .limit(1);
  return rows[0] ? toClaimDomain(rows[0]) : null;
}

export async function getSubjectClaimOrThrow(
  db: Executor,
  id: string,
): Promise<SubjectClaimRecord> {
  const found = await findSubjectClaim(db, id);
  if (!found) throw new NotFoundError('subject claim', id);
  return found;
}

export async function listSubjectClaims(
  db: Executor,
  tutorId: string,
): Promise<SubjectClaimRecord[]> {
  const rows = await db
    .select()
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.tutorId, tutorId));
  return rows.map(toClaimDomain);
}

export async function deleteSubjectClaim(db: Executor, id: string): Promise<void> {
  await db.delete(tutorSubjectClaims).where(eq(tutorSubjectClaims.id, id));
}

/* =========================================================================
 * Rates — §6.5
 * ====================================================================== */

export interface TutorRateRecord {
  id: string;
  tutorId: string;
  subjectId: string | null;
  levelId: string | null;
  rateType: RateType;
  /** Paisa. */
  amount: number;
  currency: string;
  sessionsPerWeek: number | null;
  minutesPerSession: number | null;
  mode: TeachingMode;
  groupSizeMax: number | null;
  /** Paisa, per student per month. */
  perHeadAmount: number | null;
  negotiable: boolean;
  /** Paisa. */
  travelCharge: number;
  /** Paisa per hour, per student. Computed on write, never supplied. */
  normalisedHourlyAmount: number;
  createdAt: Date;
}

type StoredRate = typeof tutorRates.$inferSelect;

function toRateDomain(row: StoredRate): TutorRateRecord {
  return {
    id: row.id,
    tutorId: row.tutorId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    rateType: row.rateType,
    amount: row.amount,
    currency: row.currency,
    sessionsPerWeek: row.sessionsPerWeek,
    minutesPerSession: row.minutesPerSession,
    mode: row.mode,
    groupSizeMax: row.groupSizeMax,
    perHeadAmount: row.perHeadAmount,
    negotiable: fromDbBool(row.negotiable),
    travelCharge: row.travelCharge,
    normalisedHourlyAmount: row.normalisedHourlyAmount,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export interface InsertRateInput {
  tutorId: string;
  subjectId: string | null;
  levelId: string | null;
  rateType: RateType;
  amount: number;
  sessionsPerWeek: number | null;
  minutesPerSession: number | null;
  mode: TeachingMode;
  groupSizeMax: number | null;
  perHeadAmount: number | null;
  negotiable: boolean;
  travelCharge: number;
  /** Computed by the service from the fields above. */
  normalisedHourlyAmount: number;
}

export async function insertTutorRate(
  db: Executor,
  input: InsertRateInput,
): Promise<TutorRateRecord> {
  const id = newId();
  await db.insert(tutorRates).values({
    id,
    tutorId: input.tutorId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    rateType: input.rateType,
    amount: input.amount,
    currency: 'PKR',
    sessionsPerWeek: input.sessionsPerWeek,
    minutesPerSession: input.minutesPerSession,
    mode: input.mode,
    groupSizeMax: input.groupSizeMax,
    perHeadAmount: input.perHeadAmount,
    negotiable: toDbBool(input.negotiable),
    travelCharge: input.travelCharge,
    normalisedHourlyAmount: input.normalisedHourlyAmount,
    createdAt: nowIso(),
  });
  return getTutorRateOrThrow(db, id);
}

export async function replaceTutorRate(
  db: Executor,
  id: string,
  input: Omit<InsertRateInput, 'tutorId'>,
): Promise<TutorRateRecord> {
  await db
    .update(tutorRates)
    .set({
      subjectId: input.subjectId,
      levelId: input.levelId,
      rateType: input.rateType,
      amount: input.amount,
      sessionsPerWeek: input.sessionsPerWeek,
      minutesPerSession: input.minutesPerSession,
      mode: input.mode,
      groupSizeMax: input.groupSizeMax,
      perHeadAmount: input.perHeadAmount,
      negotiable: toDbBool(input.negotiable),
      travelCharge: input.travelCharge,
      normalisedHourlyAmount: input.normalisedHourlyAmount,
    })
    .where(eq(tutorRates.id, id));
  return getTutorRateOrThrow(db, id);
}

export async function findTutorRate(db: Executor, id: string): Promise<TutorRateRecord | null> {
  const rows = await db.select().from(tutorRates).where(eq(tutorRates.id, id)).limit(1);
  return rows[0] ? toRateDomain(rows[0]) : null;
}

export async function getTutorRateOrThrow(db: Executor, id: string): Promise<TutorRateRecord> {
  const found = await findTutorRate(db, id);
  if (!found) throw new NotFoundError('rate', id);
  return found;
}

export async function listTutorRates(db: Executor, tutorId: string): Promise<TutorRateRecord[]> {
  const rows = await db.select().from(tutorRates).where(eq(tutorRates.tutorId, tutorId));
  return rows.map(toRateDomain);
}

export async function deleteTutorRate(db: Executor, id: string): Promise<void> {
  await db.delete(tutorRates).where(eq(tutorRates.id, id));
}

/* =========================================================================
 * Availability — FR-8.1
 * ====================================================================== */

export interface AvailabilityRecord {
  id: string;
  tutorId: string;
  weekday: number;
  /** `HH:MM`, whose lexicographic order is chronological. */
  startTime: string;
  endTime: string;
  mode: TeachingMode;
  areaId: string | null;
  createdAt: Date;
}

type StoredAvailability = typeof tutorAvailability.$inferSelect;

function toAvailabilityDomain(row: StoredAvailability): AvailabilityRecord {
  return {
    id: row.id,
    tutorId: row.tutorId,
    weekday: row.weekday,
    startTime: row.startTime,
    endTime: row.endTime,
    mode: row.mode,
    areaId: row.areaId,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function insertAvailability(
  db: Executor,
  input: {
    tutorId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    mode: TeachingMode;
    areaId: string | null;
  },
): Promise<AvailabilityRecord> {
  const id = newId();
  await db.insert(tutorAvailability).values({
    id,
    tutorId: input.tutorId,
    weekday: input.weekday,
    startTime: input.startTime,
    endTime: input.endTime,
    mode: input.mode,
    areaId: input.areaId,
    createdAt: nowIso(),
  });
  return getAvailabilityOrThrow(db, id);
}

export async function findAvailability(
  db: Executor,
  id: string,
): Promise<AvailabilityRecord | null> {
  const rows = await db
    .select()
    .from(tutorAvailability)
    .where(eq(tutorAvailability.id, id))
    .limit(1);
  return rows[0] ? toAvailabilityDomain(rows[0]) : null;
}

export async function getAvailabilityOrThrow(
  db: Executor,
  id: string,
): Promise<AvailabilityRecord> {
  const found = await findAvailability(db, id);
  if (!found) throw new NotFoundError('availability slot', id);
  return found;
}

export async function listAvailability(
  db: Executor,
  tutorId: string,
): Promise<AvailabilityRecord[]> {
  const rows = await db
    .select()
    .from(tutorAvailability)
    .where(eq(tutorAvailability.tutorId, tutorId));
  return rows.map(toAvailabilityDomain);
}

/** Overlap detection for the same weekday and mode, so a template stays sane. */
export async function findOverlappingSlots(
  db: Executor,
  tutorId: string,
  weekday: number,
  startTime: string,
  endTime: string,
  excludeId?: string,
): Promise<AvailabilityRecord[]> {
  const rows = await db
    .select()
    .from(tutorAvailability)
    .where(and(eq(tutorAvailability.tutorId, tutorId), eq(tutorAvailability.weekday, weekday)));

  return rows
    .map(toAvailabilityDomain)
    .filter((slot) => slot.id !== excludeId)
    // Half-open intervals: 09:00–11:00 and 11:00–13:00 do not overlap. Plain
    // string comparison, because zero-padded HH:MM sorts chronologically.
    .filter((slot) => slot.startTime < endTime && startTime < slot.endTime);
}

export async function deleteAvailability(db: Executor, id: string): Promise<void> {
  await db.delete(tutorAvailability).where(eq(tutorAvailability.id, id));
}
