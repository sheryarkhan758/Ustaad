/**
 * Booking aggregate — bookings, session notes, trial fit checks.
 *
 * Status changes do **not** live here.  They go through
 * `server/services/bookings.ts`, which validates the transition first; this
 * module exposes the persistence that service needs and nothing that would let
 * a caller move a booking sideways past the state machine.
 */

import { and, eq } from 'drizzle-orm';

import type { BookingActor, BookingStatus } from '../../shared/booking-status';
import {
  fromDbBool,
  fromDbJsonArray,
  fromDbTimestamp,
  newId,
  nowIso,
  toDbBool,
  toDbJson,
  toDbTimestamp,
} from '../../shared/db-values';
import type { RateType, TeachingMode } from '../../shared/rates';
import { bookings, sessionNotes, trialFitChecks } from '../db/schema/booking';
import type { EngagementType } from '../db/schema/booking';
import { studentProfiles } from '../db/schema/identity';
import { areas } from '../db/schema/reference';
import { type Executor, NotFoundError } from './_base';

export interface BookingRecord {
  id: string;
  tutorId: string;
  studentProfileId: string;
  requestedByUserId: string;
  engagementType: EngagementType;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds: string[];
  mode: TeachingMode;
  areaId: string | null;
  /** ISO-8601 UTC, or null for an engagement with no scheduled instant yet. */
  slotStart: string | null;
  slotEnd: string | null;
  agreedRate: number | null;
  rateType: RateType | null;
  travelChargeAgreed: number;
  agreedRateSnapshot: Record<string, unknown> | null;
  isTrial: boolean;
  guardianPresenceRequired: boolean;
  status: BookingStatus;
  statusChangedBy: BookingActor | null;
  requestedAt: Date;
  respondedAt: Date | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** SEC-21: excluded from the tutor's confirmation-rate denominator. */
  declineUnderSafetyConstraint: boolean;
  createdAt: Date;
}

type StoredBooking = typeof bookings.$inferSelect;

export function toBookingDomain(row: StoredBooking): BookingRecord {
  return {
    id: row.id,
    tutorId: row.tutorId,
    studentProfileId: row.studentProfileId,
    requestedByUserId: row.requestedByUserId,
    engagementType: row.engagementType,
    subjectId: row.subjectId,
    levelId: row.levelId,
    boardId: row.boardId,
    topicIds: fromDbJsonArray(row.topicIdsJson),
    mode: row.mode,
    areaId: row.areaId,
    slotStart: row.slotStart,
    slotEnd: row.slotEnd,
    agreedRate: row.agreedRate,
    rateType: row.rateType,
    travelChargeAgreed: row.travelChargeAgreed,
    agreedRateSnapshot: row.agreedRateSnapshotJson
      ? (JSON.parse(row.agreedRateSnapshotJson) as Record<string, unknown>)
      : null,
    isTrial: fromDbBool(row.isTrial),
    guardianPresenceRequired: fromDbBool(row.guardianPresenceRequired),
    status: row.status,
    statusChangedBy: row.statusChangedBy,
    requestedAt: fromDbTimestamp(row.requestedAt),
    respondedAt: fromDbTimestamp(row.respondedAt),
    confirmedAt: fromDbTimestamp(row.confirmedAt),
    completedAt: fromDbTimestamp(row.completedAt),
    cancelledAt: fromDbTimestamp(row.cancelledAt),
    cancelReason: row.cancelReason,
    declineUnderSafetyConstraint: fromDbBool(row.declineUnderSafetyConstraint),
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export interface CreateBookingInput {
  tutorId: string;
  studentProfileId: string;
  requestedByUserId: string;
  engagementType: EngagementType;
  subjectId: string;
  levelId: string;
  boardId: string;
  topicIds?: string[];
  mode: TeachingMode;
  areaId?: string | null;
  agreedRate?: number | null;
  rateType?: RateType | null;
  travelChargeAgreed?: number;
  agreedRateSnapshot?: Record<string, unknown> | null;
  isTrial?: boolean;
  guardianPresenceRequired?: boolean;
  requestedAt?: Date;
}

export async function createBooking(
  db: Executor,
  input: CreateBookingInput,
): Promise<BookingRecord> {
  const id = newId();

  await db.insert(bookings).values({
    id,
    tutorId: input.tutorId,
    studentProfileId: input.studentProfileId,
    requestedByUserId: input.requestedByUserId,
    engagementType: input.engagementType,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    topicIdsJson: toDbJson(input.topicIds ?? []) ?? '[]',
    mode: input.mode,
    areaId: input.areaId ?? null,
    agreedRate: input.agreedRate ?? null,
    rateType: input.rateType ?? null,
    travelChargeAgreed: input.travelChargeAgreed ?? 0,
    agreedRateSnapshotJson: toDbJson(input.agreedRateSnapshot),
    isTrial: toDbBool(input.isTrial ?? false),
    guardianPresenceRequired: toDbBool(input.guardianPresenceRequired ?? false),
    status: 'requested',
    requestedAt: toDbTimestamp(input.requestedAt ?? new Date()),
    createdAt: nowIso(),
  });

  return getBookingOrThrow(db, id);
}

export async function findBooking(db: Executor, id: string): Promise<BookingRecord | null> {
  const rows = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  return rows[0] ? toBookingDomain(rows[0]) : null;
}

export async function getBookingOrThrow(db: Executor, id: string): Promise<BookingRecord> {
  const found = await findBooking(db, id);
  if (!found) throw new NotFoundError('booking', id);
  return found;
}

export async function listBookingsForTutor(
  db: Executor,
  tutorId: string,
  status?: BookingStatus,
): Promise<BookingRecord[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      status
        ? and(eq(bookings.tutorId, tutorId), eq(bookings.status, status))
        : eq(bookings.tutorId, tutorId),
    );
  return rows.map(toBookingDomain);
}

export async function listBookingsForRequester(
  db: Executor,
  userId: string,
): Promise<BookingRecord[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.requestedByUserId, userId));
  return rows.map(toBookingDomain);
}

/**
 * Persist a validated status change.
 *
 * Called only by `server/services/bookings.ts`, which has already checked the
 * transition against `shared/booking-status.ts`.
 */
export interface BookingStatusPatch {
  status: BookingStatus;
  statusChangedBy: BookingActor;
  statusChangedAt: Date;
  respondedAt?: Date;
  confirmedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string | null;
  declineUnderSafetyConstraint?: boolean;
}

export async function applyBookingStatus(
  db: Executor,
  id: string,
  patch: BookingStatusPatch,
): Promise<BookingRecord> {
  const values: Record<string, unknown> = {
    status: patch.status,
    statusChangedBy: patch.statusChangedBy,
    statusChangedAt: toDbTimestamp(patch.statusChangedAt),
  };

  if (patch.respondedAt) values.respondedAt = toDbTimestamp(patch.respondedAt);
  if (patch.confirmedAt) values.confirmedAt = toDbTimestamp(patch.confirmedAt);
  if (patch.completedAt) values.completedAt = toDbTimestamp(patch.completedAt);
  if (patch.cancelledAt) values.cancelledAt = toDbTimestamp(patch.cancelledAt);
  if (patch.cancelReason !== undefined) values.cancelReason = patch.cancelReason;
  if (patch.declineUnderSafetyConstraint !== undefined) {
    values.declineUnderSafetyConstraint = toDbBool(patch.declineUnderSafetyConstraint);
  }

  await db.update(bookings).set(values).where(eq(bookings.id, id));
  return getBookingOrThrow(db, id);
}

export async function deleteBooking(db: Executor, id: string): Promise<void> {
  await db.delete(bookings).where(eq(bookings.id, id));
}

/**
 * The **only** read that returns the encrypted address, and it returns the
 * ciphertext — never the plaintext.
 *
 * `BookingRecord` deliberately has no address field at all, so no ordinary
 * handler, serialiser or log line can carry one even by accident. The single
 * caller is `server/services/address.ts`, which is the only module holding a
 * decrypt function (SEC-3, SEC-20, NFR-18).
 */
export async function findBookingAddressCiphertext(
  db: Executor,
  bookingId: string,
): Promise<string | null> {
  const rows = await db
    .select({ addressEncrypted: bookings.addressEncrypted })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return rows[0]?.addressEncrypted ?? null;
}

/**
 * Record the address on a booking. Accepts ciphertext only.
 *
 * There is no overload taking plaintext: sealing happens in
 * `server/services/address.ts#sealAddress`, so a caller cannot reach this with
 * an unencrypted street address in hand.
 */
export async function setBookingAddressCiphertext(
  db: Executor,
  bookingId: string,
  ciphertext: string,
): Promise<void> {
  if (!ciphertext.startsWith('v1.')) {
    throw new Error(
      'refusing to store a booking address that is not sealed ciphertext (NFR-18). ' +
        'Use server/services/address.ts#sealAddress.',
    );
  }
  await db
    .update(bookings)
    .set({ addressEncrypted: ciphertext })
    .where(eq(bookings.id, bookingId));
}

/* -------------------------------------------------------------------------
 * Session notes — the progress ledger, §6.12
 * ---------------------------------------------------------------------- */

export interface SessionNoteRecord {
  id: string;
  bookingId: string;
  tutorId: string;
  topicsCovered: string[];
  /** `{ [topicId]: 1..5 }` */
  masteryRatings: Record<string, number>;
  note: string | null;
  createdAt: Date;
}

export async function addSessionNote(
  db: Executor,
  input: {
    bookingId: string;
    tutorId: string;
    topicsCovered: string[];
    masteryRatings: Record<string, number>;
    note?: string | null;
  },
): Promise<SessionNoteRecord> {
  const id = newId();
  await db.insert(sessionNotes).values({
    id,
    bookingId: input.bookingId,
    tutorId: input.tutorId,
    topicsCoveredJson: toDbJson(input.topicsCovered) ?? '[]',
    masteryRatingsJson: toDbJson(input.masteryRatings) ?? '{}',
    note: input.note ?? null,
    createdAt: nowIso(),
  });

  const rows = await db.select().from(sessionNotes).where(eq(sessionNotes.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('session note', id);

  return {
    id: row.id,
    bookingId: row.bookingId,
    tutorId: row.tutorId,
    topicsCovered: fromDbJsonArray(row.topicsCoveredJson),
    masteryRatings: JSON.parse(row.masteryRatingsJson) as Record<string, number>,
    note: row.note,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function listSessionNotes(
  db: Executor,
  bookingId: string,
): Promise<SessionNoteRecord[]> {
  const rows = await db.select().from(sessionNotes).where(eq(sessionNotes.bookingId, bookingId));
  return rows.map((row) => ({
    id: row.id,
    bookingId: row.bookingId,
    tutorId: row.tutorId,
    topicsCovered: fromDbJsonArray(row.topicsCoveredJson),
    masteryRatings: JSON.parse(row.masteryRatingsJson) as Record<string, number>,
    note: row.note,
    createdAt: fromDbTimestamp(row.createdAt),
  }));
}

export async function deleteSessionNote(db: Executor, id: string): Promise<void> {
  await db.delete(sessionNotes).where(eq(sessionNotes.id, id));
}

/* -------------------------------------------------------------------------
 * Trial fit checks — PRIVATE to the requester and administrators (SEC-15)
 * ---------------------------------------------------------------------- */

export interface TrialFitCheckRecord {
  id: string;
  bookingId: string;
  submittedBy: string;
  communication: number;
  punctuality: number;
  engagement: number;
  pace: number;
  continueDecision: boolean;
  note: string | null;
  createdAt: Date;
}

/**
 * There is deliberately **no** `listTrialFitChecksForTutor`.
 *
 * A fit check is private to the family who wrote it and to administrators
 * (SEC-15), and it is never a ranking input. Not providing the query is
 * cheaper than providing it and relying on every caller to remember.
 */
export async function addTrialFitCheck(
  db: Executor,
  input: {
    bookingId: string;
    submittedBy: string;
    communication: number;
    punctuality: number;
    engagement: number;
    pace: number;
    continueDecision: boolean;
    note?: string | null;
  },
): Promise<TrialFitCheckRecord> {
  const id = newId();
  await db.insert(trialFitChecks).values({
    id,
    bookingId: input.bookingId,
    submittedBy: input.submittedBy,
    communication: input.communication,
    punctuality: input.punctuality,
    engagement: input.engagement,
    pace: input.pace,
    continueDecision: toDbBool(input.continueDecision),
    note: input.note ?? null,
    createdAt: nowIso(),
  });

  return getTrialFitCheckOrThrow(db, id);
}

export async function findTrialFitCheck(
  db: Executor,
  id: string,
): Promise<TrialFitCheckRecord | null> {
  const rows = await db.select().from(trialFitChecks).where(eq(trialFitChecks.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    bookingId: row.bookingId,
    submittedBy: row.submittedBy,
    communication: row.communication,
    punctuality: row.punctuality,
    engagement: row.engagement,
    pace: row.pace,
    continueDecision: fromDbBool(row.continueDecision),
    note: row.note,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

async function getTrialFitCheckOrThrow(
  db: Executor,
  id: string,
): Promise<TrialFitCheckRecord> {
  const found = await findTrialFitCheck(db, id);
  if (!found) throw new NotFoundError('trial fit check', id);
  return found;
}

/**
 * The fit check for a booking.
 *
 * Named for the booking rather than the check's own id because that is how
 * every legitimate caller reaches it — from the engagement. There is
 * deliberately no lookup by tutor (SEC-15).
 */
export async function findTrialFitCheckForBooking(
  db: Executor,
  bookingId: string,
): Promise<TrialFitCheckRecord | null> {
  const rows = await db
    .select()
    .from(trialFitChecks)
    .where(eq(trialFitChecks.bookingId, bookingId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    bookingId: row.bookingId,
    submittedBy: row.submittedBy,
    communication: row.communication,
    punctuality: row.punctuality,
    engagement: row.engagement,
    pace: row.pace,
    continueDecision: fromDbBool(row.continueDecision),
    note: row.note,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function deleteTrialFitCheck(db: Executor, id: string): Promise<void> {
  await db.delete(trialFitChecks).where(eq(trialFitChecks.id, id));
}

/* -------------------------------------------------------------------------
 * The pre-acceptance view — FR-29.13
 * ---------------------------------------------------------------------- */

/**
 * What a tutor may see about an engagement **before** she confirms it.
 *
 * A woman deciding whether to travel alone to a stranger's house needs four
 * facts to decide at all: where — to the area, not the doorstep — who she would
 * be teaching, whether an adult will be in the residence, and when. §6.29.2
 * gives her all four before she commits, and the exact address only on her
 * confirmation (SEC-20, FR-29.9).
 *
 * **This selects no address column, and there is none to omit by mistake.**
 * The ciphertext is reachable only through `findBookingAddressCiphertext`,
 * which this file does not call; a future edit that wanted to add the street
 * here would have to import that function deliberately, which is the point.
 */
export interface EngagementPreview {
  bookingId: string;
  mode: TeachingMode;
  /** Null for an online engagement, where there is nowhere to travel to. */
  areaId: string | null;
  areaName: string | null;
  areaNameUr: string | null;
  cityId: string | null;
  /** Null when the family did not record one. Never inferred. */
  studentGender: 'female' | 'male' | 'other' | null;
  /** Whether the student is a minor, which is why a guardian question exists. */
  studentIsMinor: boolean;
  guardianPresenceRequired: boolean;
  slotStart: Date | null;
  slotEnd: Date | null;
  travelChargeAgreed: number;
  status: BookingStatus;
}

export async function findEngagementPreview(
  db: Executor,
  bookingId: string,
): Promise<EngagementPreview | null> {
  const rows = await db
    .select({
      id: bookings.id,
      mode: bookings.mode,
      areaId: bookings.areaId,
      guardianPresenceRequired: bookings.guardianPresenceRequired,
      slotStart: bookings.slotStart,
      slotEnd: bookings.slotEnd,
      travelChargeAgreed: bookings.travelChargeAgreed,
      status: bookings.status,
      studentGender: studentProfiles.gender,
      studentParentUserId: studentProfiles.parentUserId,
    })
    .from(bookings)
    .innerJoin(studentProfiles, eq(studentProfiles.id, bookings.studentProfileId))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const areaRows = row.areaId
    ? await db
        .select({ id: areas.id, name: areas.name, nameUr: areas.nameUr, cityId: areas.cityId })
        .from(areas)
        .where(eq(areas.id, row.areaId))
        .limit(1)
    : [];
  const area = areaRows[0];

  return {
    bookingId: row.id,
    mode: row.mode,
    areaId: row.areaId,
    areaName: area?.name ?? null,
    areaNameUr: area?.nameUr ?? null,
    cityId: area?.cityId ?? null,
    studentGender: row.studentGender,
    // A minor is a profile owned by a parent — §2.3. There is no age arithmetic
    // here and no date of birth in the payload; the ownership is the fact.
    studentIsMinor: row.studentParentUserId !== null,
    guardianPresenceRequired: fromDbBool(row.guardianPresenceRequired),
    slotStart: row.slotStart ? fromDbTimestamp(row.slotStart) : null,
    slotEnd: row.slotEnd ? fromDbTimestamp(row.slotEnd) : null,
    travelChargeAgreed: row.travelChargeAgreed,
    status: row.status,
  };
}
