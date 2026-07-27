/**
 * Booking creation — §6.8, §6.29.2, §6.30, FR-33.11.
 *
 * Every guard fires **before** a booking row exists, which matters for one of
 * them in particular:
 *
 * > If a tutor has declared `female_students_only`, a booking for a male
 * > student **cannot even be requested** (SEC-19).
 *
 * The platform enforces her condition rather than advertising it. That is not
 * only tidier — SEC-21 excludes safety declines from her confirmation rate
 * precisely so that holding to her own terms costs her nothing, and the
 * cleanest way to honour that is for the decline never to be necessary. A
 * request that would force one is refused at the door.
 *
 * ── Concurrency (FR-8.6) ───────────────────────────────────────────────────
 * Two families asking for the same slot at the same moment must resolve to one
 * winner, and the winner is decided by the database, not by a check-then-act in
 * application code. `booking_slot_reservations` carries a unique index on
 * `(tutor_id, slot_start)`, and inserting into it is the moment the race is
 * settled: the loser's insert violates the constraint and is refused.
 *
 * The booking row is written first, because the reservation has a foreign key
 * to it. That ordering means the loser briefly has a booking with no slot, so
 * it is deleted immediately — a compensating action, because this codebase has
 * no portable transaction (see `server/db/index.ts`). The failure mode if the
 * process dies between the two writes is an orphaned `requested` booking
 * holding no slot, which blocks nobody; the reverse ordering would strand a
 * slot claimed by a booking that does not exist, which blocks everybody.
 */

import { and, eq, gte, lt } from 'drizzle-orm';

import type { CreateBookingInput } from '../../shared/booking';
import { newId, nowIso, toDbBool } from '../../shared/db-values';
import { bookingSlotReservations, bookings } from '../db/schema/booking';
import { studentProfiles } from '../db/schema/identity';
import { tutorProfiles } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';
import { getBookingOrThrow, type BookingRecord } from '../repositories/bookings';
import { sealAddress } from './address';
import { isTutorSearchable } from '../repositories/search';
import { checkEngagementAgainstConstraints, resolveTutorConstraints } from './tutor-onboarding';

export class BookingRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BookingRequestError';
    this.status = status;
    this.code = code;
  }
}

/** ISO week key, so a volunteer's cap is per calendar week. */
export function isoWeekBounds(at: Date): { start: string; end: string } {
  const date = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  // Monday as the first day; Sunday (0) belongs to the week that just ended.
  const shift = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - shift * 86_400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  return { start: monday.toISOString(), end: nextMonday.toISOString() };
}

const hoursBetween = (startIso: string, endIso: string): number =>
  (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;

/**
 * Volunteer weekly hour cap — FR-33.11.
 *
 * A volunteer who is over-committed stops turning up, and the families who lose
 * those sessions are the ones who could not pay for them in the first place.
 * The cap is enforced at booking rather than shown on a profile.
 */
async function assertVolunteerCapacity(
  db: Executor,
  tutorId: string,
  slotStart: string,
  slotEnd: string,
): Promise<void> {
  const rows = await db
    .select({
      volunteerFlag: tutorProfiles.volunteerFlag,
      volunteerWeeklyHours: tutorProfiles.volunteerWeeklyHours,
    })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.id, tutorId))
    .limit(1);

  const tutor = rows[0];
  if (!tutor || tutor.volunteerFlag !== 1 || tutor.volunteerWeeklyHours === null) return;

  const week = isoWeekBounds(new Date(slotStart));
  const committed = await db
    .select({
      slotStart: bookingSlotReservations.slotStart,
      slotEnd: bookingSlotReservations.slotEnd,
    })
    .from(bookingSlotReservations)
    .where(
      and(
        eq(bookingSlotReservations.tutorId, tutorId),
        gte(bookingSlotReservations.slotStart, week.start),
        lt(bookingSlotReservations.slotStart, week.end),
      ),
    );

  const already = committed.reduce((total, r) => total + hoursBetween(r.slotStart, r.slotEnd), 0);
  const requested = hoursBetween(slotStart, slotEnd);

  if (already + requested > tutor.volunteerWeeklyHours) {
    throw new BookingRequestError(
      409,
      'volunteer_capacity_exceeded',
      `This volunteer tutor gives ${tutor.volunteerWeeklyHours} hour(s) a week and already has ` +
        `${already} hour(s) booked that week. Try a different week.`,
    );
  }
}

export interface CreateBookingResult {
  booking: BookingRecord;
}

export async function createBookingRequest(
  db: Executor,
  input: CreateBookingInput & { requestedByUserId: string },
  now: Date = new Date(),
): Promise<CreateBookingResult> {
  /* --- 1. The tutor must be one a family could have found --------------- */

  if (!(await isTutorSearchable(db, input.tutorId))) {
    // Same answer as "no such tutor": an unapproved profile must not become
    // discoverable by guessing an id (FR-6.3).
    throw new BookingRequestError(404, 'tutor_not_found', 'No such tutor.');
  }

  if (new Date(input.slotStart).getTime() <= now.getTime()) {
    throw new BookingRequestError(400, 'slot_in_past', 'That session time has already passed.');
  }

  /* --- 2. The learner, and who may act for them ------------------------- */

  const studentRows = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.id, input.studentProfileId))
    .limit(1);
  const student = studentRows[0];

  if (!student) {
    throw new BookingRequestError(404, 'student_not_found', 'No such student profile.');
  }

  // A minor's profile is acted on by their parent; an adult student acts for
  // themselves. Nobody else, ever (SEC-1, SEC-2).
  const mayAct =
    student.parentUserId === input.requestedByUserId ||
    student.selfUserId === input.requestedByUserId;
  if (!mayAct) {
    throw new BookingRequestError(404, 'student_not_found', 'No such student profile.');
  }

  /* --- 3. The tutor's own conditions — SEC-19, enforced not displayed ---- */

  const constraints = await resolveTutorConstraints(db, input.tutorId);
  const violations = checkEngagementAgainstConstraints(constraints, {
    studentGender: student.gender,
    areaId: input.areaId,
    guardianPresenceOffered: input.guardianPresenceAcknowledged,
    mode: input.mode,
  });

  if (violations.length > 0) {
    throw new BookingRequestError(
      409,
      'tutor_constraints_not_met',
      violations.map((v) => v.message).join(' '),
    );
  }

  /* --- 4. Volunteer capacity — FR-33.11 --------------------------------- */

  await assertVolunteerCapacity(db, input.tutorId, input.slotStart, input.slotEnd);

  /* --- 5. Write the booking, then claim the slot ------------------------ */

  const bookingId = newId();
  const engagement = input;

  await db.insert(bookings).values({
    id: bookingId,
    tutorId: input.tutorId,
    studentProfileId: input.studentProfileId,
    requestedByUserId: input.requestedByUserId,
    engagementType: input.engagementType,
    sessionPurpose:
      engagement.engagementType === 'single_session' ? engagement.sessionPurpose : null,
    packageSessionsTotal:
      engagement.engagementType === 'short_term_package'
        ? engagement.packageSessionsTotal
        : engagement.engagementType === 'monthly'
          ? engagement.sessionsPerWeek * engagement.cycleWeeks
          : null,
    packageSessionsUsed: 0,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId,
    topicIdsJson: JSON.stringify(input.topicIds),
    mode: input.mode,
    areaId: input.areaId,
    // Sealed here; the plaintext never reaches a column (SEC-3, NFR-18).
    addressEncrypted: input.address ? sealAddress(input.address) : null,
    slotStart: input.slotStart,
    slotEnd: input.slotEnd,
    isTrial: toDbBool(input.isTrial),
    guardianPresenceRequired: toDbBool(
      constraints.guardianPresenceRequired || input.guardianPresenceAcknowledged,
    ),
    groupId: engagement.engagementType === 'group' ? engagement.groupProposalId : null,
    status: 'requested',
    requestedAt: now.toISOString(),
    createdAt: nowIso(),
  });

  /* --- 6. The race is settled here, by the unique index ------------------ */

  try {
    await db.insert(bookingSlotReservations).values({
      id: newId(),
      bookingId,
      tutorId: input.tutorId,
      slotStart: input.slotStart,
      slotEnd: input.slotEnd,
      createdAt: nowIso(),
    });
  } catch (error) {
    // Losing the race is an expected outcome, not an internal error. Undo the
    // booking so it does not linger without a slot.
    await db.delete(bookings).where(eq(bookings.id, bookingId));

    const message = error instanceof Error ? error.message : '';
    if (/UNIQUE|unique|duplicate key/i.test(message)) {
      throw new BookingRequestError(
        409,
        'slot_taken',
        'That slot has just been taken. Please choose another time.',
      );
    }
    throw error;
  }

  return { booking: await getBookingOrThrow(db, bookingId) };
}

/**
 * Free the slot.
 *
 * Called when a booking reaches a terminal state that is not `completed`. The
 * reservation row's absence *is* the slot being free, so there is no second
 * place for the two to disagree.
 */
export async function releaseSlot(db: Executor, bookingId: string): Promise<void> {
  await db
    .delete(bookingSlotReservations)
    .where(eq(bookingSlotReservations.bookingId, bookingId));
}
