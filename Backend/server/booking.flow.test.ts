/**
 * Booking, end to end — §6.8, §6.20, §6.30, §6.12.
 *
 * Covers the seven cases the brief names: a monthly cycle, a single session, a
 * trial plus private fit check, a double-booking attempt that fails, an illegal
 * transition that 409s, a safety-constraint violation that cannot be requested,
 * and a volunteer over-commitment that is refused.
 */

import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../shared/db-values';
import { createApp } from './app';
import { bookingSlotReservations } from './db/schema/booking';
import { studentProfiles, users } from './db/schema/identity';
import {
  SEARCHABLE_PROFILE_STATUS,
  tutorAvailability,
  tutorProfiles,
  tutorSafetyConstraints,
} from './db/schema/tutor';
import { createSeededTestDb, type TestDb } from './db/test-db';
import { findTrialFitCheckForBooking, getBookingOrThrow } from './repositories/bookings';
import { computeReliability } from './jobs/tutor-reliability';
import { generateSlots, pktToUtc, pktWeekday } from './services/slots';

const PASSWORD = 'a-sufficiently-long-password';

let db: TestDb;
let app: ReturnType<typeof createApp>;

/** A Monday comfortably in the future, so `notBefore` never trims a slot. */
const MONDAY = '2027-03-01';

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function registerAs(role: 'parent' | 'tutor' | 'student', email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: PASSWORD,
      role,
      displayName: email,
      ...(role === 'student' ? { dateOfBirth: '1998-01-01' } : {}),
    });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

interface TutorOptions {
  femaleStudentsOnly?: boolean;
  guardianPresenceRequired?: boolean;
  restrictedAreaIds?: string[];
  volunteerWeeklyHours?: number;
  gender?: 'female' | 'male';
}

async function makeTutor(email: string, options: TutorOptions = {}): Promise<{
  cookie: string;
  tutorId: string;
  userId: string;
}> {
  const cookie = await registerAs('tutor', email);
  const rows = await db.select().from(users).where(eq(users.email, email));
  const userId = rows[0]!.id;

  const tutorId = newId();
  await db.insert(tutorProfiles).values({
    id: tutorId,
    userId,
    gender: options.gender ?? 'female',
    cityId: 'karachi',
    slug: email.split('@')[0]!,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    teachesAtHome: 1,
    volunteerFlag: options.volunteerWeeklyHours !== undefined ? 1 : 0,
    volunteerWeeklyHours: options.volunteerWeeklyHours ?? null,
    willingAreasJson: JSON.stringify(['karachi-gulshan-e-iqbal']),
    createdAt: nowIso(),
  });

  // Mondays, 16:00–20:00 Pakistan time.
  await db.insert(tutorAvailability).values({
    id: newId(),
    tutorId,
    weekday: pktWeekday(MONDAY),
    startTime: '16:00',
    endTime: '20:00',
    mode: 'home',
    areaId: 'karachi-gulshan-e-iqbal',
    createdAt: nowIso(),
  });

  if (
    options.femaleStudentsOnly ||
    options.guardianPresenceRequired ||
    options.restrictedAreaIds
  ) {
    await db.insert(tutorSafetyConstraints).values({
      id: newId(),
      tutorId,
      femaleStudentsOnly: options.femaleStudentsOnly ? 1 : 0,
      guardianPresenceRequired: options.guardianPresenceRequired ? 1 : 0,
      restrictedAreaIdsJson: JSON.stringify(options.restrictedAreaIds ?? []),
      updatedAt: nowIso(),
    });
  }

  return { cookie, tutorId, userId };
}

async function makeFamily(
  email: string,
  studentGender: 'female' | 'male' = 'female',
): Promise<{ cookie: string; userId: string; studentProfileId: string }> {
  const cookie = await registerAs('parent', email);
  const rows = await db.select().from(users).where(eq(users.email, email));
  const userId = rows[0]!.id;

  const studentProfileId = newId();
  await db.insert(studentProfiles).values({
    id: studentProfileId,
    parentUserId: userId,
    name: 'A Student',
    gender: studentGender,
    levelId: 'matric',
    boardId: 'sindh-board',
    dateOfBirth: '2011-05-05',
    createdAt: nowIso(),
  });

  return { cookie, userId, studentProfileId };
}

function slot(localStart: string, minutes = 60): { slotStart: string; slotEnd: string } {
  const start = pktToUtc(MONDAY, localStart);
  return {
    slotStart: start.toISOString(),
    slotEnd: new Date(start.getTime() + minutes * 60_000).toISOString(),
  };
}

function baseBooking(tutorId: string, studentProfileId: string) {
  return {
    tutorId,
    studentProfileId,
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    mode: 'home' as const,
    areaId: 'karachi-gulshan-e-iqbal',
  };
}

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

/* =========================================================================
 * Slot generation
 * ====================================================================== */

describe('slot generation', () => {
  it('expands a weekly template across a range and subtracts live bookings', async () => {
    const tutor = await makeTutor('slots@example.test');
    const family = await makeFamily('slotfamily@example.test');

    const before = await generateSlots(db, {
      tutorId: tutor.tutorId,
      fromDate: MONDAY,
      toDate: MONDAY,
      notBefore: new Date('2027-01-01T00:00:00Z'),
    });
    // 16:00–20:00 in one-hour slots.
    expect(before).toHaveLength(4);
    expect(before.map((s) => s.localStart)).toEqual(['16:00', '17:00', '18:00', '19:00']);

    await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'concept_clarification',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('17:00'),
      });

    const after = await generateSlots(db, {
      tutorId: tutor.tutorId,
      fromDate: MONDAY,
      toDate: MONDAY,
      notBefore: new Date('2027-01-01T00:00:00Z'),
    });
    expect(after.map((s) => s.localStart)).toEqual(['16:00', '18:00', '19:00']);
  });

  it('blocks every slot a longer session overlaps, not just its start', async () => {
    const tutor = await makeTutor('overlap@example.test');
    const family = await makeFamily('overlapfamily@example.test');

    await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'exam_revision',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('17:00', 120),
      });

    const slots = await generateSlots(db, {
      tutorId: tutor.tutorId,
      fromDate: MONDAY,
      toDate: MONDAY,
      notBefore: new Date('2027-01-01T00:00:00Z'),
    });
    expect(slots.map((s) => s.localStart)).toEqual(['16:00', '19:00']);
  });

  it('frees the slot again when a booking is declined', async () => {
    const tutor = await makeTutor('freed@example.test');
    const family = await makeFamily('freedfamily@example.test');

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    await request(app)
      .post(`/api/bookings/${created.body.booking.id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'declined', reason: 'I am away that week.' });

    const slots = await generateSlots(db, {
      tutorId: tutor.tutorId,
      fromDate: MONDAY,
      toDate: MONDAY,
      notBefore: new Date('2027-01-01T00:00:00Z'),
    });
    expect(slots.map((s) => s.localStart)).toContain('16:00');
  });
});

/* =========================================================================
 * 1. A monthly cycle
 * ====================================================================== */

describe('a monthly engagement', () => {
  it('books a recurring cycle and records the session total', async () => {
    const tutor = await makeTutor('monthly@example.test');
    const family = await makeFamily('monthlyfamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'monthly',
        sessionsPerWeek: 3,
        cycleWeeks: 4,
        topicIds: ['math-matric-sindh-quadratic-equations'],
        address: 'House 42, Block 13-D, Gulshan-e-Iqbal, Karachi',
        ...slot('16:00', 90),
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.engagementType).toBe('monthly');
    expect(res.body.booking.status).toBe('requested');

    const stored = await getBookingOrThrow(db, res.body.booking.id);
    expect(stored.topicIds).toEqual(['math-matric-sindh-quadratic-equations']);

    // The address is sealed on the way in and absent from the record shape.
    expect(JSON.stringify(res.body)).not.toContain('Gulshan-e-Iqbal, Karachi');
    expect(stored).not.toHaveProperty('addressEncrypted');
  });

  it('runs the full happy path to completion', async () => {
    const tutor = await makeTutor('happy@example.test');
    const family = await makeFamily('happyfamily@example.test');

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'monthly',
        sessionsPerWeek: 2,
        cycleWeeks: 4,
        ...slot('16:00'),
      });
    const id = created.body.booking.id;

    for (const [to, cookie] of [
      ['confirmed', tutor.cookie],
      ['in_progress', tutor.cookie],
      ['completed', tutor.cookie],
    ] as const) {
      const res = await request(app)
        .post(`/api/bookings/${id}/transition`)
        .set('Cookie', cookie)
        .send({ to });
      expect(res.status, to).toBe(200);
      expect(res.body.booking.status).toBe(to);
    }

    // Session notes feed the progress ledger (§6.12).
    const note = await request(app)
      .post(`/api/bookings/${id}/notes`)
      .set('Cookie', tutor.cookie)
      .send({
        topicsCovered: ['math-matric-sindh-quadratic-equations'],
        masteryRatings: { 'math-matric-sindh-quadratic-equations': 4 },
        note: 'تجزی پر بہتری آئی۔ Completing the square still needs work.',
      });

    expect(note.status).toBe(201);
    expect(note.body.note.masteryRatings).toEqual({
      'math-matric-sindh-quadratic-equations': 4,
    });
    // Mixed script, stored unchanged (§2.10).
    expect(note.body.note.note).toContain('تجزی');
  });
});

/* =========================================================================
 * 2. A single session — a first-class engagement (§2.6, FR-30.4, FR-30.11)
 * ====================================================================== */

describe('a single session', () => {
  it('carries a purpose and topics so the tutor arrives prepared (FR-30.4)', async () => {
    const tutor = await makeTutor('single@example.test');
    const family = await makeFamily('singlefamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'assessment_review',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(201);
    expect(res.body.booking.engagementType).toBe('single_session');
    expect(res.body.booking.topicIds).toHaveLength(1);
  });

  it('CANNOT be requested without a purpose — it is not a trimmed monthly', async () => {
    const tutor = await makeTutor('nopurpose@example.test');
    const family = await makeFamily('nopurposefamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(400);
  });

  it('cannot be requested without topics either', async () => {
    const tutor = await makeTutor('notopics@example.test');
    const family = await makeFamily('notopicsfamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: [],
        ...slot('16:00'),
      });

    expect(res.status).toBe(400);
  });

  it('earns a real review on completion, exactly as a monthly does (FR-30.11)', async () => {
    const tutor = await makeTutor('review@example.test');
    const family = await makeFamily('reviewfamily@example.test');

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'concept_clarification',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });
    const id = created.body.booking.id;

    for (const to of ['confirmed', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/bookings/${id}/transition`)
        .set('Cookie', tutor.cookie)
        .send({ to });
    }

    const { createReview } = await import('./repositories/reviews');
    const review = await createReview(db, {
      bookingId: id,
      tutorId: tutor.tutorId,
      reviewerUserId: family.userId,
      reviewerRole: 'parent',
      rating: 5,
      text: 'One hour, and the confusion about completing the square was gone.',
    });

    // No shorter-engagement exclusion: the review gate is "completed booking".
    expect(review.id).toBeTruthy();
    expect(review.rating).toBe(5);
  });
});

/* =========================================================================
 * 3. A trial plus a private fit check — §6.20, SEC-15, decision 11
 * ====================================================================== */

describe('a trial session and its fit check', () => {
  async function completedTrial() {
    const tutor = await makeTutor('trial@example.test');
    const family = await makeFamily('trialfamily@example.test');

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'concept_clarification',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        isTrial: true,
        ...slot('16:00'),
      });

    const id = created.body.booking.id;
    expect(created.body.booking.isTrial).toBe(true);

    for (const to of ['confirmed', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/bookings/${id}/transition`)
        .set('Cookie', tutor.cookie)
        .send({ to });
    }
    return { tutor, family, id };
  }

  it('accepts a fit check from the requester after the trial completes', async () => {
    const { family, id } = await completedTrial();

    const res = await request(app)
      .post(`/api/bookings/${id}/fit-check`)
      .set('Cookie', family.cookie)
      .send({
        communication: 5,
        punctuality: 4,
        engagement: 5,
        pace: 3,
        continueDecision: true,
        note: 'Explains well. Slightly fast for her, but she wants to continue.',
      });

    expect(res.status).toBe(201);
    expect(res.body.fitCheck.continueDecision).toBe(true);
  });

  it('is INVISIBLE to the tutor, which is what keeps it candid', async () => {
    const { tutor, family, id } = await completedTrial();

    await request(app)
      .post(`/api/bookings/${id}/fit-check`)
      .set('Cookie', family.cookie)
      .send({
        communication: 2,
        punctuality: 2,
        engagement: 2,
        pace: 2,
        continueDecision: false,
        note: 'Did not explain clearly and arrived late.',
      });

    // The tutor is a party to this booking and still cannot read it (SEC-15).
    const asTutor = await request(app)
      .get(`/api/bookings/${id}/fit-check`)
      .set('Cookie', tutor.cookie);
    expect(asTutor.status).toBe(404);
    expect(JSON.stringify(asTutor.body)).not.toMatch(/arrived late/i);

    // Nor is it anywhere in the booking the tutor can read.
    const booking = await request(app).get(`/api/bookings/${id}`).set('Cookie', tutor.cookie);
    expect(JSON.stringify(booking.body)).not.toMatch(/arrived late/i);

    // The family can read their own.
    const asFamily = await request(app)
      .get(`/api/bookings/${id}/fit-check`)
      .set('Cookie', family.cookie);
    expect(asFamily.status).toBe(200);
    expect(asFamily.body.fitCheck.note).toMatch(/arrived late/i);
  });

  it('refuses a fit check on a booking that is not a trial', async () => {
    const tutor = await makeTutor('nottrial@example.test');
    const family = await makeFamily('nottrialfamily@example.test');

    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'monthly',
        sessionsPerWeek: 2,
        cycleWeeks: 4,
        ...slot('16:00'),
      });

    for (const to of ['confirmed', 'in_progress', 'completed'] as const) {
      await request(app)
        .post(`/api/bookings/${created.body.booking.id}/transition`)
        .set('Cookie', tutor.cookie)
        .send({ to });
    }

    const res = await request(app)
      .post(`/api/bookings/${created.body.booking.id}/fit-check`)
      .set('Cookie', family.cookie)
      .send({ communication: 4, punctuality: 4, engagement: 4, pace: 4, continueDecision: true });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('not_a_trial');
  });

  it('exposes no repository lookup by tutor, so none can be added by accident', async () => {
    const repo = await import('./repositories/bookings');
    for (const name of Object.keys(repo)) {
      // A `listTrialFitChecksForTutor` would make SEC-15 one careless import
      // away from being violated, so it does not exist.
      if (/FitCheck/i.test(name)) expect(name).not.toMatch(/Tutor/i);
    }

    const { id } = await completedTrial();
    expect(await findTrialFitCheckForBooking(db, id)).toBeNull();
  });
});

/* =========================================================================
 * 4. Double booking — FR-8.6
 * ====================================================================== */

describe('double booking', () => {
  it('refuses a second booking for a slot already taken', async () => {
    const tutor = await makeTutor('clash@example.test');
    const a = await makeFamily('clash-a@example.test');
    const b = await makeFamily('clash-b@example.test');

    const body = (studentProfileId: string) => ({
      ...baseBooking(tutor.tutorId, studentProfileId),
      engagementType: 'single_session' as const,
      sessionPurpose: 'doubt_solving' as const,
      topicIds: ['math-matric-sindh-quadratic-equations'],
      ...slot('16:00'),
    });

    const first = await request(app)
      .post('/api/bookings')
      .set('Cookie', a.cookie)
      .send(body(a.studentProfileId));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/bookings')
      .set('Cookie', b.cookie)
      .send(body(b.studentProfileId));

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('slot_taken');
  });

  it('lets exactly ONE of two SIMULTANEOUS requests succeed', async () => {
    const tutor = await makeTutor('race@example.test');
    const a = await makeFamily('race-a@example.test');
    const b = await makeFamily('race-b@example.test');

    const body = (studentProfileId: string) => ({
      ...baseBooking(tutor.tutorId, studentProfileId),
      engagementType: 'single_session' as const,
      sessionPurpose: 'exam_revision' as const,
      topicIds: ['math-matric-sindh-quadratic-equations'],
      ...slot('18:00'),
    });

    // Fired together, not sequenced. The winner is decided by the unique index
    // on (tutor_id, slot_start), not by a check-then-act in application code.
    const [first, second] = await Promise.all([
      request(app).post('/api/bookings').set('Cookie', a.cookie).send(body(a.studentProfileId)),
      request(app).post('/api/bookings').set('Cookie', b.cookie).send(body(b.studentProfileId)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Exactly one reservation, and exactly one booking holding the slot.
    const reservations = await db
      .select()
      .from(bookingSlotReservations)
      .where(eq(bookingSlotReservations.tutorId, tutor.tutorId));
    expect(reservations).toHaveLength(1);
  });

  it('leaves no orphan reservation when a booking insert fails', async () => {
    const tutor = await makeTutor('orphan@example.test');
    const family = await makeFamily('orphanfamily@example.test');

    // A subject id that violates the foreign key, so the booking insert throws
    // after the reservation has already been claimed.
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        subjectId: 'no-such-subject',
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('19:00'),
      });

    expect(res.status).toBe(500);

    // The compensating delete ran: the slot is not permanently claimed by a
    // booking that does not exist.
    const reservations = await db
      .select()
      .from(bookingSlotReservations)
      .where(eq(bookingSlotReservations.tutorId, tutor.tutorId));
    expect(reservations).toHaveLength(0);
  });
});

/* =========================================================================
 * 5. Illegal transitions — 409
 * ====================================================================== */

describe('the lifecycle state machine', () => {
  async function requested() {
    const tutor = await makeTutor('lifecycle@example.test');
    const family = await makeFamily('lifecyclefamily@example.test');
    const created = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });
    return { tutor, family, id: created.body.booking.id as string };
  }

  it('409s on a jump straight from requested to completed', async () => {
    const { tutor, id } = await requested();

    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'completed' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('illegal_transition');
    // The message names what would have been allowed, so the caller can act.
    expect(res.body.error.message).toMatch(/allowed: confirmed, declined, cancelled/);
  });

  it('409s on reopening a terminal booking', async () => {
    const { tutor, id } = await requested();

    await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'declined', reason: 'I am fully booked that month.' });

    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'confirmed' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/terminal/);
  });

  it('409s on a no-op transition rather than silently accepting it', async () => {
    const { tutor, id } = await requested();
    await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'confirmed' });

    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'confirmed' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already/);
  });

  it('requires a reason to cancel or decline', async () => {
    const { tutor, id } = await requested();
    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({ to: 'declined' });

    expect(res.status).toBe(400);
  });

  it('records a safety decline so reliability excludes it (SEC-21)', async () => {
    const { tutor, id } = await requested();

    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', tutor.cookie)
      .send({
        to: 'declined',
        reason: 'The area is outside the ones I travel to.',
        declineUnderSafetyConstraint: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.booking.declineUnderSafetyConstraint).toBe(true);

    const stats = computeReliability(tutor.tutorId, [
      {
        status: 'declined',
        declineUnderSafetyConstraint: 1,
        requestedAt: nowIso(),
        respondedAt: nowIso(),
        slotStart: null,
        completedAt: null,
      },
    ]);
    // Absent from the denominator, so holding to her own terms costs nothing.
    expect(stats.bookingBasis).toBe(0);
    expect(stats.safetyDeclinesExcluded).toBe(1);
  });

  it('refuses to let the family claim a safety decline on the tutor\'s behalf', async () => {
    const { family, id } = await requested();

    const res = await request(app)
      .post(`/api/bookings/${id}/transition`)
      .set('Cookie', family.cookie)
      .send({
        to: 'cancelled',
        reason: 'Changed our minds.',
        declineUnderSafetyConstraint: true,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_your_constraint');
  });
});

/* =========================================================================
 * 6. Safety constraints — SEC-19, enforced at request time
 * ====================================================================== */

describe('tutor safety constraints are enforced, not advertised', () => {
  it('a booking for a male student CANNOT BE REQUESTED from a female-only tutor', async () => {
    const tutor = await makeTutor('femaleonly@example.test', { femaleStudentsOnly: true });
    const family = await makeFamily('boyfamily@example.test', 'male');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('tutor_constraints_not_met');

    // No booking, and no slot claimed — the request never became anything she
    // would have had to decline (SEC-19, SEC-21).
    const reservations = await db.select().from(bookingSlotReservations);
    expect(reservations).toHaveLength(0);
  });

  it('the same tutor accepts a female student', async () => {
    const tutor = await makeTutor('femaleonly2@example.test', { femaleStudentsOnly: true });
    const family = await makeFamily('girlfamily@example.test', 'female');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(201);
  });

  it('requires the guardian-presence acknowledgement when she has declared it', async () => {
    const tutor = await makeTutor('guardian@example.test', { guardianPresenceRequired: true });
    const family = await makeFamily('guardianfamily@example.test');

    const withoutIt = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });
    expect(withoutIt.status).toBe(409);
    expect(withoutIt.body.error.message).toMatch(/guardian/i);

    const withIt = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        guardianPresenceAcknowledged: true,
        ...slot('16:00'),
      });
    expect(withIt.status).toBe(201);
    expect(withIt.body.booking.guardianPresenceRequired).toBe(true);
  });

  it('refuses an area she has restricted', async () => {
    const tutor = await makeTutor('restricted@example.test', {
      restrictedAreaIds: ['karachi-malir'],
    });
    const family = await makeFamily('malirfamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        areaId: 'karachi-malir',
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/does not travel/i);
  });
});

/* =========================================================================
 * 7. Volunteer hour cap — FR-33.11
 * ====================================================================== */

describe('volunteer weekly hour cap', () => {
  it('refuses a booking that would take a volunteer past their declared hours', async () => {
    const tutor = await makeTutor('volunteer@example.test', { volunteerWeeklyHours: 2 });
    const family = await makeFamily('volunteerfamily@example.test');

    const book = (localStart: string) =>
      request(app)
        .post('/api/bookings')
        .set('Cookie', family.cookie)
        .send({
          ...baseBooking(tutor.tutorId, family.studentProfileId),
          engagementType: 'single_session',
          sessionPurpose: 'doubt_solving',
          topicIds: ['math-matric-sindh-quadratic-equations'],
          ...slot(localStart),
        });

    expect((await book('16:00')).status).toBe(201);
    expect((await book('17:00')).status).toBe(201);

    // Two hours declared, two hours booked.
    const third = await book('18:00');
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('volunteer_capacity_exceeded');
    expect(third.body.error.message).toMatch(/2 hour\(s\) a week/);
  });

  it('does not cap a paid tutor', async () => {
    const tutor = await makeTutor('paid@example.test');
    const family = await makeFamily('paidfamily@example.test');

    for (const localStart of ['16:00', '17:00', '18:00', '19:00']) {
      const res = await request(app)
        .post('/api/bookings')
        .set('Cookie', family.cookie)
        .send({
          ...baseBooking(tutor.tutorId, family.studentProfileId),
          engagementType: 'single_session',
          sessionPurpose: 'doubt_solving',
          topicIds: ['math-matric-sindh-quadratic-equations'],
          ...slot(localStart),
        });
      expect(res.status, localStart).toBe(201);
    }
  });
});

/* =========================================================================
 * Ownership
 * ====================================================================== */

describe('ownership', () => {
  it('refuses a booking for another family\'s student', async () => {
    const tutor = await makeTutor('own@example.test');
    const mine = await makeFamily('own-a@example.test');
    const theirs = await makeFamily('own-b@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', mine.cookie)
      .send({
        ...baseBooking(tutor.tutorId, theirs.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    // 404, identical to a student profile that does not exist.
    expect(res.status).toBe(404);
  });

  it('refuses a booking against an unapproved tutor', async () => {
    const tutor = await makeTutor('unapproved@example.test');
    await db
      .update(tutorProfiles)
      .set({ profileStatus: 'pending_verification' })
      .where(eq(tutorProfiles.id, tutor.tutorId));

    const family = await makeFamily('unapprovedfamily@example.test');
    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', family.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(404);
  });

  it('refuses a tutor trying to book on a family\'s behalf', async () => {
    const tutor = await makeTutor('tutorbooks@example.test');
    const family = await makeFamily('tutorbooksfamily@example.test');

    const res = await request(app)
      .post('/api/bookings')
      .set('Cookie', tutor.cookie)
      .send({
        ...baseBooking(tutor.tutorId, family.studentProfileId),
        engagementType: 'single_session',
        sessionPurpose: 'doubt_solving',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        ...slot('16:00'),
      });

    expect(res.status).toBe(403);
  });
});
