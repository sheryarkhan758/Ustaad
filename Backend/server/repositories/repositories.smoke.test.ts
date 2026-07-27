/**
 * Repository smoke test.
 *
 * Inserts, reads and deletes one row through **every** repository, and asserts
 * that the boundary translation in `shared/db-values.ts` round-trips: what goes
 * in as a `boolean` comes back as a `boolean`, what goes in as an array or an
 * object comes back as an array or an object, and what goes in as a `Date`
 * comes back as an equal `Date`.
 *
 * This runs against SQLite. Its value on deployment day is that the same file
 * runs unchanged against Postgres — the assertions are about domain values, not
 * about storage, which is the whole claim `server/db/PORTABILITY.md` makes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  EMPTY_JSON_ARRAY,
  fromDbBool,
  fromDbJson,
  fromDbJsonArray,
  fromDbTimestamp,
  toDbBool,
  toDbJson,
  toDbTimestamp,
} from '../../shared/db-values';
import { createBookingFixture, createSeededTestDb, type TestDb } from '../db/test-db';
import * as bookingsRepo from './bookings';
import * as feedbackRepo from './feedback';
import * as paymentsRepo from './payments';
import * as reviewsRepo from './reviews';
import * as tutorsRepo from './tutors';
import * as volunteersRepo from './volunteers';

let db: TestDb;
let fx: Awaited<ReturnType<typeof createBookingFixture>>;

beforeEach(async () => {
  db = await createSeededTestDb();
  fx = await createBookingFixture(db);
});

afterEach(() => {
  db = undefined as unknown as TestDb;
});

/* =========================================================================
 * The helpers themselves
 * ====================================================================== */

describe('db-values helpers', () => {
  it('round-trips booleans through integer 0/1', () => {
    expect(toDbBool(true)).toBe(1);
    expect(toDbBool(false)).toBe(0);
    expect(fromDbBool(toDbBool(true))).toBe(true);
    expect(fromDbBool(toDbBool(false))).toBe(false);
  });

  it('refuses a boolean column holding anything other than 0 or 1', () => {
    // Truthy text is the classic SQLite → Postgres migration failure. Reading
    // it as `true` because it happens to be truthy would hide the corruption.
    expect(() => fromDbBool(2)).toThrow(RangeError);
    expect(() => fromDbBool('1' as unknown as number)).toThrow(RangeError);
  });

  it('round-trips JSON through one serialiser', () => {
    const value = { topics: ['a', 'b'], nested: { n: 1 }, flag: true };
    expect(fromDbJson<typeof value>(toDbJson(value))).toEqual(value);
    expect(fromDbJsonArray(toDbJson(['x', 'y']))).toEqual(['x', 'y']);
    expect(fromDbJsonArray(null)).toEqual([]);
    expect(fromDbJsonArray(EMPTY_JSON_ARRAY)).toEqual([]);
  });

  it('stores absent JSON as NULL, not as the string "null"', () => {
    expect(toDbJson(undefined)).toBeNull();
    expect(toDbJson(null)).toBeNull();
  });

  it('round-trips timestamps as fixed-width ISO-8601 UTC text', () => {
    const when = new Date('2026-08-05T10:30:00.123Z');
    const stored = toDbTimestamp(when);
    expect(stored).toBe('2026-08-05T10:30:00.123Z');
    expect(stored).toHaveLength(24);
    expect(fromDbTimestamp(stored).getTime()).toBe(when.getTime());
  });

  it('keeps ISO-8601 text sortable in chronological order', () => {
    // The property `ORDER BY created_at` depends on, in both engines.
    const earlier = toDbTimestamp(new Date('2026-08-05T09:59:59.999Z'));
    const later = toDbTimestamp(new Date('2026-08-05T10:00:00.000Z'));
    expect(earlier < later).toBe(true);
  });
});

/* =========================================================================
 * One insert / read / delete per repository
 * ====================================================================== */

describe('tutors repository', () => {
  it('inserts, reads and deletes a profile with booleans and JSON intact', async () => {
    const created = await tutorsRepo.createTutorProfile(db, {
      userId: fx.adminUserId,
      gender: 'female',
      cityId: 'karachi',
      slug: 'smoke-tutor',
      teachesAtHome: true,
      teachesOnline: false,
      willingAreaIds: ['karachi-clifton', 'karachi-dha'],
      volunteer: true,
      profileStatus: 'approved',
    });

    expect(created.teachesAtHome).toBe(true);
    expect(created.teachesOnline).toBe(false);
    expect(created.volunteer).toBe(true);
    expect(created.willingAreaIds).toEqual(['karachi-clifton', 'karachi-dha']);
    expect(created.createdAt).toBeInstanceOf(Date);

    const read = await tutorsRepo.getTutorProfileOrThrow(db, created.id);
    expect(read).toEqual(created);

    // A false boolean must survive as `false`, not as `0` and not as absent.
    const flipped = await tutorsRepo.updateTutorModes(db, created.id, { teachesOnline: true });
    expect(flipped.teachesOnline).toBe(true);
    expect(flipped.teachesAtOwnPlace).toBe(false);

    await tutorsRepo.deleteTutorProfile(db, created.id);
    expect(await tutorsRepo.findTutorProfile(db, created.id)).toBeNull();
  });

  it('round-trips safety constraints, including an empty array', async () => {
    const saved = await tutorsRepo.upsertSafetyConstraints(db, {
      tutorId: fx.tutorProfileId,
      femaleStudentsOnly: true,
      guardianPresenceRequired: false,
      restrictedAreaIds: [],
    });

    expect(saved.femaleStudentsOnly).toBe(true);
    expect(saved.guardianPresenceRequired).toBe(false);
    expect(saved.restrictedAreaIds).toEqual([]);

    const updated = await tutorsRepo.upsertSafetyConstraints(db, {
      tutorId: fx.tutorProfileId,
      femaleStudentsOnly: true,
      guardianPresenceRequired: true,
      restrictedAreaIds: ['karachi-malir'],
    });
    expect(updated.restrictedAreaIds).toEqual(['karachi-malir']);
  });

  it('refuses a document path that is not a private bucket key', async () => {
    await expect(
      tutorsRepo.addTutorDocument(db, {
        tutorId: fx.tutorProfileId,
        docType: 'cnic_front',
        storagePath: 'https://example.com/cnic.jpg',
      }),
    ).rejects.toThrow(/private bucket|signed URL/i);

    const doc = await tutorsRepo.addTutorDocument(db, {
      tutorId: fx.tutorProfileId,
      docType: 'cnic_front',
      storagePath: `tutors/${fx.tutorProfileId}/cnic-front.jpg`,
    });
    expect(doc.uploadedAt).toBeInstanceOf(Date);

    await tutorsRepo.deleteTutorDocument(db, doc.id);
    expect(await tutorsRepo.listTutorDocuments(db, fx.tutorProfileId)).toEqual([]);
  });
});

describe('bookings repository', () => {
  it('inserts, reads and deletes a booking with its JSON and flags intact', async () => {
    const requestedAt = new Date('2026-08-01T08:00:00.000Z');

    const created = await bookingsRepo.createBooking(db, {
      tutorId: fx.tutorProfileId,
      studentProfileId: fx.studentProfileId,
      requestedByUserId: fx.parentUserId,
      engagementType: 'single_session',
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIds: ['math-matric-sindh-quadratic-equations'],
      mode: 'home',
      areaId: 'karachi-clifton',
      isTrial: true,
      guardianPresenceRequired: true,
      agreedRate: 120_000,
      rateType: 'single_session',
      agreedRateSnapshot: { rateType: 'single_session', amount: 120_000, minutesPerSession: 90 },
      requestedAt,
    });

    expect(created.topicIds).toEqual(['math-matric-sindh-quadratic-equations']);
    expect(created.isTrial).toBe(true);
    expect(created.guardianPresenceRequired).toBe(true);
    expect(created.declineUnderSafetyConstraint).toBe(false);
    expect(created.agreedRateSnapshot).toEqual({
      rateType: 'single_session',
      amount: 120_000,
      minutesPerSession: 90,
    });
    expect(created.requestedAt.getTime()).toBe(requestedAt.getTime());
    expect(created.status).toBe('requested');

    const read = await bookingsRepo.getBookingOrThrow(db, created.id);
    expect(read).toEqual(created);

    await bookingsRepo.deleteBooking(db, created.id);
    expect(await bookingsRepo.findBooking(db, created.id)).toBeNull();
  });

  it('round-trips a session note, including the mastery rating map', async () => {
    const note = await bookingsRepo.addSessionNote(db, {
      bookingId: fx.bookingId,
      tutorId: fx.tutorProfileId,
      topicsCovered: ['math-matric-sindh-algebraic-factorisation'],
      masteryRatings: { 'math-matric-sindh-algebraic-factorisation': 3 },
      note: 'طالبہ نے تجزی میں بہتری دکھائی — mixed script, stored unchanged.',
    });

    expect(note.masteryRatings).toEqual({ 'math-matric-sindh-algebraic-factorisation': 3 });
    // User text is never normalised or translated (§2.10).
    expect(note.note).toBe('طالبہ نے تجزی میں بہتری دکھائی — mixed script, stored unchanged.');

    await bookingsRepo.deleteSessionNote(db, note.id);
    expect(await bookingsRepo.listSessionNotes(db, fx.bookingId)).toEqual([]);
  });

  it('round-trips a trial fit check with its boolean decision', async () => {
    const check = await bookingsRepo.addTrialFitCheck(db, {
      bookingId: fx.bookingId,
      submittedBy: fx.parentUserId,
      communication: 4,
      punctuality: 5,
      engagement: 4,
      pace: 3,
      continueDecision: false,
    });

    expect(check.continueDecision).toBe(false);
    expect(await bookingsRepo.findTrialFitCheck(db, check.id)).toEqual(check);

    await bookingsRepo.deleteTrialFitCheck(db, check.id);
    expect(await bookingsRepo.findTrialFitCheck(db, check.id)).toBeNull();
  });
});

describe('reviews repository', () => {
  it('inserts, reads and deletes a review, storing text byte-for-byte', async () => {
    const text = 'Bohat acha padhaya — بہت اچھا پڑھایا. Concepts clear ho gaye.';

    const review = await reviewsRepo.createReview(db, {
      bookingId: fx.bookingId,
      tutorId: fx.tutorProfileId,
      reviewerUserId: fx.parentUserId,
      reviewerRole: 'parent',
      rating: 5,
      text,
    });

    expect(review.text).toBe(text);
    expect(review.createdAt).toBeInstanceOf(Date);
    expect(await reviewsRepo.listPublicReviewsForTutor(db, fx.tutorProfileId)).toHaveLength(1);

    const analysis = await reviewsRepo.saveReviewAnalysis(db, {
      reviewId: review.id,
      contentHash: 'sha256-smoke',
      dimensions: { punctuality: { sentiment: 'positive', evidence: 'Bohat acha padhaya' } },
      credibility: { generic: false, sessions: 12 },
      topicsMentioned: ['math-matric-sindh-quadratic-equations'],
      safetyConcernFlag: false,
      model: 'gemini-2.0-flash',
      promptVersion: 'review-intelligence.v1',
    });

    expect(analysis.safetyConcernFlag).toBe(false);
    expect(analysis.dimensions).toEqual({
      punctuality: { sentiment: 'positive', evidence: 'Bohat acha padhaya' },
    });
    expect(analysis.topicsMentioned).toEqual(['math-matric-sindh-quadratic-equations']);
    expect(await reviewsRepo.findAnalysisByContentHash(db, 'sha256-smoke')).toMatchObject({
      reviewId: review.id,
    });

    await reviewsRepo.deleteReviewAnalysis(db, analysis.id);
    await reviewsRepo.deleteReview(db, review.id);
    expect(await reviewsRepo.findReview(db, review.id)).toBeNull();
  });

  it('rejects a rating outside 1–5 rather than storing it', async () => {
    await expect(
      reviewsRepo.createReview(db, {
        bookingId: fx.bookingId,
        tutorId: fx.tutorProfileId,
        reviewerUserId: fx.parentUserId,
        reviewerRole: 'parent',
        rating: 6,
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('payments repository', () => {
  it('inserts, reads and deletes a payment record with nullable timestamps', async () => {
    const record = await paymentsRepo.insertPaymentRecord(db, {
      bookingId: fx.bookingId,
      cycleLabel: '2026-08',
      agreedAmount: 800_000,
      travelCharge: 50_000,
      rateType: 'monthly',
      engagementType: 'monthly',
    });

    expect(record.agreedAmount).toBe(800_000);
    expect(record.familyMarkedPaidAt).toBeNull();
    expect(record.tutorConfirmedAt).toBeNull();
    expect(record.status).toBe('pending');

    const at = new Date('2026-08-05T10:00:00.000Z');
    const marked = await paymentsRepo.updatePaymentRecord(db, record.id, {
      familyMarkedPaidAt: at,
      status: 'family_marked',
    });
    expect(marked.familyMarkedPaidAt).toBeInstanceOf(Date);
    expect(marked.familyMarkedPaidAt!.getTime()).toBe(at.getTime());

    const dispute = await paymentsRepo.insertDispute(db, {
      paymentRecordId: record.id,
      raisedBy: fx.tutorUserId,
      raisedByParty: 'tutor',
      reason: 'not_received',
    });
    expect(dispute.resolvedAt).toBeNull();
    expect(await paymentsRepo.countOpenDisputesBy(db, fx.tutorUserId)).toBe(1);

    await paymentsRepo.deleteDispute(db, dispute.id);
    await paymentsRepo.deletePaymentRecord(db, record.id);
    expect(await paymentsRepo.findPaymentRecord(db, record.id)).toBeNull();
  });
});

describe('feedback repository', () => {
  it('inserts, reads and deletes platform feedback', async () => {
    const created = await feedbackRepo.createFeedback(db, {
      userId: fx.parentUserId,
      role: 'parent',
      category: 'incorrect_ai_output',
      detail: 'Diagnostic agent ne ghalat topic suggest kiya — غلط موضوع تجویز کیا۔',
      satisfactionRating: 2,
      pagePath: '/diagnose',
      locale: 'ur',
      appVersion: '0.1.0',
      safetyConcernFlag: false,
    });

    expect(created.safetyConcernFlag).toBe(false);
    expect(created.status).toBe('new');
    // The row exists before any mail is attempted (FR-32.9, decision 22).
    expect(created.mailDispatchStatus).toBe('pending');
    expect(created.createdAt).toBeInstanceOf(Date);

    const dispatched = await feedbackRepo.recordMailDispatch(db, created.id, 'failed');
    expect(dispatched.mailDispatchStatus).toBe('failed');
    // A failed dispatch must not lose the record.
    expect(await feedbackRepo.findFeedback(db, created.id)).not.toBeNull();

    await feedbackRepo.deleteFeedback(db, created.id);
    expect(await feedbackRepo.findFeedback(db, created.id)).toBeNull();
  });

  it('stores an anonymous submission with no identity fields at all', async () => {
    const anon = await feedbackRepo.createFeedback(db, {
      category: 'usability',
      detail: 'Urdu view breaks the filter row on a small screen.',
      // A role is offered but must be discarded for an anonymous report.
      role: 'parent',
      safetyConcernFlag: true,
    });

    expect(anon.userId).toBeNull();
    expect(anon.role).toBeNull();
    expect(anon.safetyConcernFlag).toBe(true);
    expect(await feedbackRepo.listSafetyConcerns(db)).toHaveLength(1);

    await feedbackRepo.deleteFeedback(db, anon.id);
  });
});

describe('volunteers repository', () => {
  it('inserts, reads and deletes an application with its JSON arrays intact', async () => {
    const created = await volunteersRepo.createVolunteerApplication(db, {
      fullName: 'Test Volunteer',
      email: 'volunteer@example.test',
      phone: '0300-0000000',
      cityId: 'karachi',
      areaId: 'karachi-nazimabad',
      gender: 'female',
      subjectIds: ['mathematics', 'physics'],
      levelIds: ['matric'],
      weeklyHours: 4,
      deliveryModes: ['home', 'online'],
      motivation: 'Main apne mohalle ki larkiyon ko parhana chahti hoon.',
      documentPath: 'volunteers/test-volunteer/cv.pdf',
    });

    expect(created.subjectIds).toEqual(['mathematics', 'physics']);
    expect(created.deliveryModes).toEqual(['home', 'online']);
    expect(created.status).toBe('received');
    expect(created.mailDispatchStatus).toBe('pending');
    expect(created.convertedTutorId).toBeNull();

    const read = await volunteersRepo.getVolunteerApplicationOrThrow(db, created.id);
    expect(read).toEqual(created);
    expect(await volunteersRepo.listByEmail(db, 'volunteer@example.test')).toHaveLength(1);
    expect(await volunteersRepo.listByStatus(db, 'received')).toHaveLength(1);

    await volunteersRepo.deleteVolunteerApplication(db, created.id);
    expect(await volunteersRepo.findVolunteerApplication(db, created.id)).toBeNull();
  });

  it('refuses a CV path outside the private bucket', async () => {
    await expect(
      volunteersRepo.createVolunteerApplication(db, {
        fullName: 'Test Volunteer',
        email: 'volunteer2@example.test',
        documentPath: '/var/www/public/cv.pdf',
      }),
    ).rejects.toThrow();
  });
});
