/**
 * Role and ownership authorisation — NFR-6.
 *
 * Role alone says "you are a parent". It does not say "you are *this student's*
 * parent", and on a platform holding minors' names, schools and session
 * histories the second question is the one that keeps one family's data away
 * from another.
 *
 * These tests mount a small application over the real middleware and the real
 * repositories, with routes standing in for the ones §6.8 and §6.12 will bring.
 */

import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../../shared/db-values';
import { createSeededTestDb, type TestDb } from '../db/test-db';
import { bookings } from '../db/schema/booking';
import { studentProfiles, users } from '../db/schema/identity';
import { tutorProfiles } from '../db/schema/tutor';
import { getBookingOrThrow } from '../repositories/bookings';
import {
  authenticate,
  errorHandler,
  requireAuth,
  requireOwnership,
  requireRole,
} from './auth';
import { ACCESS_COOKIE, signAccessToken } from '../services/auth';

interface Family {
  parentUserId: string;
  studentProfileId: string;
  bookingId: string;
}

let db: TestDb;
let app: Express;
let tutorUserId: string;
let tutorProfileId: string;
let adminUserId: string;
let familyA: Family;
let familyB: Family;

async function makeUser(
  role: 'parent' | 'tutor' | 'admin' | 'student',
  email: string,
): Promise<string> {
  const id = newId();
  await db.insert(users).values({
    id,
    email,
    passwordHash: 'not-a-real-hash',
    role,
    displayName: email,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  return id;
}

async function makeFamily(email: string): Promise<Family> {
  const parentUserId = await makeUser('parent', email);

  const studentProfileId = newId();
  await db.insert(studentProfiles).values({
    id: studentProfileId,
    parentUserId,
    name: `Child of ${email}`,
    levelId: 'matric',
    boardId: 'sindh-board',
    dateOfBirth: '2012-01-01',
    createdAt: nowIso(),
  });

  const bookingId = newId();
  await db.insert(bookings).values({
    id: bookingId,
    tutorId: tutorProfileId,
    studentProfileId,
    requestedByUserId: parentUserId,
    engagementType: 'monthly',
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIdsJson: '[]',
    mode: 'home',
    areaId: 'karachi-clifton',
    status: 'confirmed',
    requestedAt: nowIso(),
    createdAt: nowIso(),
  });

  return { parentUserId, studentProfileId, bookingId };
}

/** A signed cookie for a user, so tests need not log in through bcrypt. */
function cookieFor(userId: string, role: 'parent' | 'tutor' | 'admin' | 'student'): string {
  return `${ACCESS_COOKIE}=${signAccessToken({ sub: userId, role, tv: 1 })}`;
}

beforeEach(async () => {
  db = await createSeededTestDb();

  tutorUserId = await makeUser('tutor', 'tutor@example.test');
  adminUserId = await makeUser('admin', 'admin@example.test');

  tutorProfileId = newId();
  await db.insert(tutorProfiles).values({
    id: tutorProfileId,
    userId: tutorUserId,
    gender: 'female',
    cityId: 'karachi',
    slug: 'ownership-tutor',
    profileStatus: 'approved',
    createdAt: nowIso(),
  });

  familyA = await makeFamily('parent-a@example.test');
  familyB = await makeFamily('parent-b@example.test');

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });
  app.use(authenticate);

  // The two parties to a booking: the account that requested it, and the tutor.
  const bookingOwners = async (req: express.Request) => {
    const booking = await getBookingOrThrow(db, String(req.params.id)).catch(() => null);
    if (!booking) return null;
    return { ownerUserIds: [booking.requestedByUserId, tutorUserId] };
  };

  app.get(
    '/bookings/:id',
    requireAuth,
    requireOwnership(bookingOwners, { entity: 'booking' }),
    async (req, res) => {
      const booking = await getBookingOrThrow(db, String(req.params.id));
      res.json({ booking: { id: booking.id, status: booking.status } });
    },
  );

  app.get(
    '/admin/bookings/:id',
    requireAuth,
    requireOwnership(bookingOwners, { entity: 'booking', allowRoles: ['admin'] }),
    (_req, res) => res.json({ ok: true }),
  );

  app.get('/admin/only', requireRole('admin'), (_req, res) => res.json({ ok: true }));
  app.get('/tutor/only', requireRole('tutor'), (_req, res) => res.json({ ok: true }));
  app.get('/family/only', requireRole('parent', 'student'), (_req, res) => res.json({ ok: true }));
  app.get('/public', (_req, res) => res.json({ ok: true }));

  app.use(errorHandler);
});

/* =========================================================================
 * requireRole
 * ====================================================================== */

describe('requireRole', () => {
  it('admits the named role', async () => {
    const res = await request(app).get('/admin/only').set('Cookie', cookieFor(adminUserId, 'admin'));
    expect(res.status).toBe(200);
  });

  it('refuses every other role, including a tutor on an admin route', async () => {
    for (const [id, role] of [
      [tutorUserId, 'tutor'],
      [familyA.parentUserId, 'parent'],
    ] as const) {
      const res = await request(app).get('/admin/only').set('Cookie', cookieFor(id, role));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
  });

  it('does not reveal which role would have been sufficient', async () => {
    const res = await request(app)
      .get('/admin/only')
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    expect(JSON.stringify(res.body)).not.toMatch(/admin/i);
  });

  it('refuses an anonymous caller with 401, not 403', async () => {
    const res = await request(app).get('/admin/only');
    expect(res.status).toBe(401);
  });

  it('accepts any of several named roles', async () => {
    const res = await request(app)
      .get('/family/only')
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));
    expect(res.status).toBe(200);

    const refused = await request(app).get('/family/only').set('Cookie', cookieFor(tutorUserId, 'tutor'));
    expect(refused.status).toBe(403);
  });

  it('never trusts a role claimed in the body over the one in the token', async () => {
    const res = await request(app)
      .get('/admin/only')
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'))
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  it('leaves unauthenticated browsing open (FR-1.6)', async () => {
    const res = await request(app).get('/public');
    expect(res.status).toBe(200);
  });
});

/* =========================================================================
 * requireOwnership — the one that matters
 * ====================================================================== */

describe('requireOwnership', () => {
  it('lets a parent read their own booking', async () => {
    const res = await request(app)
      .get(`/bookings/${familyA.bookingId}`)
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(familyA.bookingId);
  });

  it('REFUSES a parent reading another parent\'s booking', async () => {
    const res = await request(app)
      .get(`/bookings/${familyB.bookingId}`)
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('booking');
  });

  it('returns 404 rather than 403, so ids cannot be enumerated', async () => {
    // Someone else's real booking and a booking that does not exist must be
    // indistinguishable. A 403 for one and a 404 for the other turns the
    // endpoint into an existence oracle.
    const someoneElses = await request(app)
      .get(`/bookings/${familyB.bookingId}`)
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    const imaginary = await request(app)
      .get(`/bookings/${newId()}`)
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    expect(someoneElses.status).toBe(imaginary.status);
    expect(someoneElses.body).toEqual(imaginary.body);
  });

  it('lets the tutor party read the booking', async () => {
    const res = await request(app)
      .get(`/bookings/${familyA.bookingId}`)
      .set('Cookie', cookieFor(tutorUserId, 'tutor'));

    expect(res.status).toBe(200);
  });

  it('does NOT exempt an administrator unless the route says so', async () => {
    const refused = await request(app)
      .get(`/bookings/${familyA.bookingId}`)
      .set('Cookie', cookieFor(adminUserId, 'admin'));
    expect(refused.status).toBe(404);

    const allowed = await request(app)
      .get(`/admin/bookings/${familyA.bookingId}`)
      .set('Cookie', cookieFor(adminUserId, 'admin'));
    expect(allowed.status).toBe(200);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get(`/bookings/${familyA.bookingId}`);
    expect(res.status).toBe(401);
  });

  it('is not fooled by a token signed for a different user', async () => {
    // Family A's parent presenting a token whose subject is family B's parent
    // would work — that is what a stolen token is. What must not work is
    // presenting *their own* token and naming B's booking.
    const res = await request(app)
      .get(`/bookings/${familyB.bookingId}`)
      .set('Cookie', cookieFor(familyA.parentUserId, 'parent'));

    expect(res.status).toBe(404);
  });

  it('keeps one family away from another across every seeded family', async () => {
    const pairs = [
      [familyA, familyB],
      [familyB, familyA],
    ] as const;

    for (const [viewer, target] of pairs) {
      const res = await request(app)
        .get(`/bookings/${target.bookingId}`)
        .set('Cookie', cookieFor(viewer.parentUserId, 'parent'));
      expect(res.status).toBe(404);
    }
  });
});
