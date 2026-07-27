import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../shared/db-values';
import { adminDashboardCountsSchema } from '../shared/moderation';
import { createApp } from './app';
import { hashPassword } from './services/auth';
import { createBookingFixture, createSeededTestDb, type TestDb } from './db/test-db';
import { users } from './db/schema/identity';
import { tutorProfiles, tutorSubjectClaims, SEARCHABLE_PROFILE_STATUS } from './db/schema/tutor';
import { bookings, sessionNotes } from './db/schema/booking';
import { paymentDisputes, paymentRecords } from './db/schema/payment';
import { platformFeedback, volunteerApplications } from './db/schema/platform';
import { flags, adminActions, vacancyInterests } from './db/schema/admin';
import { unmetDemand } from './db/schema/matching';
import { verificationRecords } from './db/schema/verification';
import { studentProfiles } from './db/schema/identity';

let db: TestDb;
let app: ReturnType<typeof createApp>;
let adminCookie: string;

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function loginAdmin(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookiesOf(res);
}

/** Creates an account with the given role and returns its session cookie. */
async function loginAs(
  email: string,
  role: 'parent' | 'tutor' | 'organisation',
  password: string,
): Promise<string> {
  await db.insert(users).values({
    id: newId(),
    email,
    passwordHash: await hashPassword(password),
    role,
    displayName: `${role} account`,
    gender: role === 'tutor' ? 'female' : null,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return cookiesOf(res);
}

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);

  const fixture = await createBookingFixture(db);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword('admin-pass-123') })
    .where(eq(users.id, fixture.adminUserId));
  adminCookie = await loginAdmin('admin@example.test', 'admin-pass-123');

  const pendingTutorUserId = newId();
  await db.insert(users).values({
    id: pendingTutorUserId,
    email: 'pending-tutor@example.test',
    passwordHash: await hashPassword('pending-pass-123'),
    role: 'tutor',
    displayName: 'Pending Tutor',
    gender: 'female',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  await db.insert(tutorProfiles).values({
    id: newId(),
    userId: pendingTutorUserId,
    gender: 'female',
    cityId: 'karachi',
    slug: 'dashboard-expiring',
    profileStatus: 'pending_verification',
    teachesAtHome: 1,
    createdAt: nowIso(),
  });

  await db.insert(tutorSubjectClaims).values({
    id: newId(),
    tutorId: fixture.tutorProfileId,
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIdsJson: '["math-matric-sindh-quadratic-equations"]',
    claimStatus: 'verified',
    verifiedAt: nowIso(),
    expiresOn: '2026-08-05',
    createdAt: nowIso(),
  });

  await db.insert(paymentRecords).values({
    id: newId(),
    bookingId: fixture.bookingId,
    cycleLabel: '2027-03',
    agreedAmount: 1000,
    travelCharge: 0,
    rateType: 'monthly',
    engagementType: 'monthly',
    status: 'pending',
    createdAt: nowIso(),
  });
  await db.insert(paymentDisputes).values({
    id: newId(),
    paymentRecordId: (await db.select().from(paymentRecords).where(eq(paymentRecords.bookingId, fixture.bookingId))).at(0)!.id,
    raisedBy: fixture.parentUserId,
    raisedByParty: 'family',
    reason: 'The arrangement was never completed as described.',
    detail: 'No sessions took place.',
    status: 'open',
    createdAt: nowIso(),
  });

  await db.insert(platformFeedback).values({
    id: newId(),
    userId: fixture.parentUserId,
    role: 'parent',
    category: 'usability',
    detail: 'The dashboard counter was confusing.',
    satisfactionRating: 3,
    pagePath: '/search',
    locale: 'en',
    appVersion: 'test',
    safetyConcernFlag: 0,
    status: 'new',
    mailDispatchStatus: 'pending',
    createdAt: nowIso(),
  });

  await db.insert(volunteerApplications).values({
    id: newId(),
    fullName: 'Volunteer One',
    email: 'volunteer@example.test',
    phone: '03001234567',
    cityId: 'karachi',
    areaId: 'karachi-clifton',
    gender: 'female',
    subjectsJson: '["mathematics"]',
    levelsJson: '["matric"]',
    weeklyHours: 8,
    deliveryModesJson: '["home"]',
    motivation: 'I want to help students.',
    documentPath: null,
    status: 'received',
    mailDispatchStatus: 'pending',
    createdAt: nowIso(),
  });

  await db.insert(flags).values({
    id: newId(),
    targetType: 'tutor_profile',
    targetId: fixture.tutorProfileId,
    reporterUserId: fixture.parentUserId,
    reason: 'inaccurate_profile',
    detail: 'Profile bio does not match the booking discussion.',
    status: 'open',
    createdAt: nowIso(),
  });

  for (let i = 0; i < 3; i += 1) {
    await db.insert(unmetDemand).values({
      id: newId(),
      subjectId: 'mathematics',
      topicIdsJson: '["math-matric-sindh-quadratic-equations"]',
      levelId: 'matric',
      boardId: 'sindh-board',
      areaId: 'karachi-clifton',
      genderPreference: 'female_only',
      budgetMax: 8000,
      reason: 'no_matches',
      createdAt: nowIso(),
    });
  }
});

describe('admin dashboard and moderation', () => {
  it('returns real counts from seeded and inserted rows', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      pendingVerifications: 1,
      documentsAwaitingReview: 0,
      pendingOrganisations: 0,
      openFlags: 1,
      safetyConcernReviews: 0,
      openVerificationAppeals: 0,
      openDisputes: 1,
      newFeedback: 1,
      newVolunteerApplications: 1,
      unmetDemandGaps: 1,
      activeEngagements: 1,
      expiringVerifications: 1,
    });

    // FR-14.3 "totals by role" — every role present, even at zero.
    expect(res.body.counts.usersByRole).toMatchObject({
      parent: expect.any(Number),
      student: expect.any(Number),
      tutor: expect.any(Number),
      organisation: expect.any(Number),
      admin: expect.any(Number),
    });
    expect(res.body.counts.usersByRole.admin).toBeGreaterThanOrEqual(1);
  });

  it('conforms to the FR-14.3 contract and leaks no row, id or name', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', adminCookie);

    // Parses against the shared schema — a count the interface expects and the
    // server stopped sending would fail here rather than render as blank.
    expect(adminDashboardCountsSchema.safeParse(res.body.counts).success).toBe(true);

    // Everything is a number or a map of numbers. Nothing that could be an id.
    for (const [key, value] of Object.entries(res.body.counts)) {
      if (key === 'usersByRole') {
        expect(Object.values(value as Record<string, unknown>).every((v) => typeof v === 'number')).toBe(true);
        continue;
      }
      expect(typeof value, `${key} must be a count`).toBe('number');
    }
  });

  it('refuses the dashboard to a non-administrator', async () => {
    const anonymous = await request(app).get('/api/admin/dashboard');
    expect(anonymous.status).toBe(401);

    const parentCookie = await loginAs('parent-dash@example.test', 'parent', 'parent-pass-123');
    const parent = await request(app).get('/api/admin/dashboard').set('Cookie', parentCookie);
    expect(parent.status).toBe(403);
  });

  it('accepts a user flag and resolves it with an audited reason', async () => {
    const created = await request(app)
      .post('/api/flags')
      .set('Cookie', adminCookie)
      .send({
        targetType: 'review',
        targetId: 'review-123',
        reason: 'abusive_content',
        detail: 'The review includes personal attacks.',
      });

    expect(created.status).toBe(201);

    const resolved = await request(app)
      .post(`/api/admin/flags/${created.body.flag.id}/resolve`)
      .set('Cookie', adminCookie)
      .send({ decision: 'actioned', reason: 'The report is confirmed and the content was removed.' });

    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('actioned');
    const auditRows = await db.select().from(adminActions).where(eq(adminActions.action, 'flag.resolved'));
    expect(auditRows).toHaveLength(1);
    // The audit entry carries the reasoning, not just the verdict (FR-14.4).
    expect(JSON.parse(auditRows[0]!.detailJson!)).toMatchObject({
      to: 'actioned',
      reason: 'The report is confirmed and the content was removed.',
    });
  });

  it('refuses to resolve the same report twice', async () => {
    const created = await request(app)
      .post('/api/flags')
      .set('Cookie', adminCookie)
      .send({ targetType: 'vacancy', targetId: 'vacancy-1', reason: 'misleading_rate' });

    const body = { decision: 'dismissed', reason: 'The posted rate matches the advertised one.' };
    const first = await request(app)
      .post(`/api/admin/flags/${created.body.flag.id}/resolve`)
      .set('Cookie', adminCookie)
      .send(body);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/admin/flags/${created.body.flag.id}/resolve`)
      .set('Cookie', adminCookie)
      .send(body);
    // A second resolution would append an audit entry describing a transition
    // that did not happen.
    expect(second.status).toBe(409);
    expect(
      await db.select().from(adminActions).where(eq(adminActions.action, 'flag.resolved')),
    ).toHaveLength(1);
  });

  it('demands a written reason for a resolution', async () => {
    const created = await request(app)
      .post('/api/flags')
      .set('Cookie', adminCookie)
      .send({ targetType: 'user', targetId: 'user-1', reason: 'abusive_content' });

    const res = await request(app)
      .post(`/api/admin/flags/${created.body.flag.id}/resolve`)
      .set('Cookie', adminCookie)
      .send({ decision: 'dismissed', reason: 'no' });

    expect(res.status).toBe(400);
  });

  it('refuses the flag queue to a non-administrator', async () => {
    const parentCookie = await loginAs('parent-flags@example.test', 'parent', 'parent-pass-123');
    expect((await request(app).get('/api/admin/flags').set('Cookie', parentCookie)).status).toBe(403);
  });

  it('rejects a flag target the schema has no column for', async () => {
    // §4.2 puts in-app chat permanently out of scope, so there is no message to
    // report. The Zod enum and the column enum are now one list.
    const res = await request(app)
      .post('/api/flags')
      .set('Cookie', adminCookie)
      .send({ targetType: 'message', targetId: 'm-1', reason: 'abusive_content' });
    expect(res.status).toBe(400);
  });
});

/* =========================================================================
 * Organisation module — §6.13, trimmed by decision 4
 * ====================================================================== */

describe('organisation module', () => {
  const password = 'org-pass-123456';

  async function approvedOrg(): Promise<{ cookie: string; orgId: string }> {
    const cookie = await loginAs('org@example.test', 'organisation', password);
    const created = await request(app)
      .put('/api/organisations/me')
      .set('Cookie', cookie)
      .send({
        orgName: 'الاقرأ اکیڈمی',
        orgType: 'academy',
        cityId: 'karachi',
        areaId: 'karachi-clifton',
        contactEmail: 'desk@example.test',
        contactPhone: '02135000000',
        description: 'Matric and intermediate coaching.',
      });
    expect(created.status).toBe(200);

    const decided = await request(app)
      .post(`/api/admin/organisations/${created.body.organisation.id}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'approved', reason: 'Registration certificate and premises confirmed.' });
    expect(decided.status).toBe(200);

    return { cookie, orgId: created.body.organisation.id };
  }

  it('stores an Urdu organisation name byte-for-byte and never translates it', async () => {
    const { orgId } = await approvedOrg();
    const res = await request(app).get(`/api/organisations/${orgId}`);
    expect(res.status).toBe(200);
    expect(res.body.organisation.orgName).toBe('الاقرأ اکیڈمی');
  });

  it('keeps an unapproved organisation off the public surface and out of posting', async () => {
    const cookie = await loginAs('pending-org@example.test', 'organisation', password);
    const created = await request(app)
      .put('/api/organisations/me')
      .set('Cookie', cookie)
      .send({ orgName: 'Unapproved Academy', orgType: 'academy', cityId: 'karachi' });
    expect(created.status).toBe(200);
    expect(created.body.organisation.approvedAt).toBeNull();

    // 404, not 403 — an unapproved id is not confirmed to exist.
    expect((await request(app).get(`/api/organisations/${created.body.organisation.id}`)).status).toBe(404);

    const posted = await request(app)
      .post('/api/organisations/me/vacancies')
      .set('Cookie', cookie)
      .send({ subjectId: 'mathematics', levelId: 'matric', mode: 'home' });
    expect(posted.status).toBe(403);

    // And the dashboard counts it as awaiting approval (FR-6.11).
    const dash = await request(app).get('/api/admin/dashboard').set('Cookie', adminCookie);
    expect(dash.body.counts.pendingOrganisations).toBe(1);
  });

  it('audits the approval decision with the administrator and the reasoning', async () => {
    await approvedOrg();
    const rows = await db
      .select()
      .from(adminActions)
      .where(eq(adminActions.action, 'organisation.approved'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.adminUserId).toBeTruthy();
    expect(JSON.parse(rows[0]!.detailJson!).reason).toContain('premises confirmed');
  });

  it('posts a vacancy, browses it publicly, and takes one-action interest', async () => {
    const { cookie } = await approvedOrg();

    const vacancy = await request(app)
      .post('/api/organisations/me/vacancies')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        mode: 'home',
        // Integer paisa (§2.1) — PKR 25,000.
        rateOffered: 2_500_000,
        rateType: 'monthly',
        areaId: 'karachi-clifton',
        description: 'Two evenings a week.',
      });
    expect(vacancy.status).toBe(201);
    expect(vacancy.body.vacancy.rateOffered).toBe(2_500_000);

    // FR-13.6 — publicly browsable, no account required.
    const board = await request(app).get('/api/vacancies?subjectId=mathematics');
    expect(board.status).toBe(200);
    expect(board.body.items).toHaveLength(1);

    // FR-13.4 — a verified tutor expresses interest in one action, no body.
    const tutorCookie = await verifiedTutorCookie();
    const first = await request(app)
      .post(`/api/vacancies/${vacancy.body.vacancy.id}/interest`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(first.status).toBe(201);
    expect(first.body.interest.status).toBe('expressed');

    // Pressing it twice is still one expression of interest.
    const again = await request(app)
      .post(`/api/vacancies/${vacancy.body.vacancy.id}/interest`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.alreadyExpressed).toBe(true);

    const interests = await request(app)
      .get(`/api/organisations/me/vacancies/${vacancy.body.vacancy.id}/interests`)
      .set('Cookie', cookie);
    expect(interests.body.items).toHaveLength(1);
  });

  it('refuses interest from a tutor who has not passed identity verification', async () => {
    const { cookie } = await approvedOrg();
    const vacancy = await request(app)
      .post('/api/organisations/me/vacancies')
      .set('Cookie', cookie)
      .send({ subjectId: 'mathematics', levelId: 'matric', mode: 'home' });

    const tutorCookie = await loginAs('draft-tutor@example.test', 'tutor', 'tutor-pass-123');
    const tutorUser = (
      await db.select().from(users).where(eq(users.email, 'draft-tutor@example.test'))
    )[0]!;
    await db.insert(tutorProfiles).values({
      id: newId(),
      userId: tutorUser.id,
      gender: 'female',
      cityId: 'karachi',
      slug: 'draft-tutor',
      profileStatus: 'pending_verification',
      teachesAtHome: 1,
      createdAt: nowIso(),
    });

    // Verification gates every path that reaches a person, not only search.
    const res = await request(app)
      .post(`/api/vacancies/${vacancy.body.vacancy.id}/interest`)
      .set('Cookie', tutorCookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it('exposes no route that advances an interest — FR-13.5 is not built', async () => {
    const { cookie } = await approvedOrg();
    const vacancy = await request(app)
      .post('/api/organisations/me/vacancies')
      .set('Cookie', cookie)
      .send({ subjectId: 'mathematics', levelId: 'matric', mode: 'home' });

    const tutorCookie = await verifiedTutorCookie();
    await request(app)
      .post(`/api/vacancies/${vacancy.body.vacancy.id}/interest`)
      .set('Cookie', tutorCookie)
      .send({});

    // Decision 4 removed the applicant-tracking system. No endpoint reaches
    // shortlisted, contacted or closed.
    for (const status of ['shortlisted', 'contacted', 'closed']) {
      const res = await request(app)
        .patch(`/api/organisations/me/vacancies/${vacancy.body.vacancy.id}/interests`)
        .set('Cookie', cookie)
        .send({ status });
      expect(res.status).toBe(404);
    }

    const rows = await db.select().from(vacancyInterests);
    expect(rows.every((row) => row.status === 'expressed')).toBe(true);
  });

  it('refuses to let one organisation close another one\'s vacancy', async () => {
    const { cookie } = await approvedOrg();
    const vacancy = await request(app)
      .post('/api/organisations/me/vacancies')
      .set('Cookie', cookie)
      .send({ subjectId: 'mathematics', levelId: 'matric', mode: 'home' });

    const otherCookie = await loginAs('other-org@example.test', 'organisation', password);
    const other = await request(app)
      .put('/api/organisations/me')
      .set('Cookie', otherCookie)
      .send({ orgName: 'Other Academy', orgType: 'school', cityId: 'lahore' });
    await request(app)
      .post(`/api/admin/organisations/${other.body.organisation.id}/decision`)
      .set('Cookie', adminCookie)
      .send({ decision: 'approved', reason: 'Registration certificate confirmed on file.' });

    const res = await request(app)
      .patch(`/api/organisations/me/vacancies/${vacancy.body.vacancy.id}`)
      .set('Cookie', otherCookie)
      .send({ status: 'closed' });
    // 404 rather than 403 — a non-owner does not learn the vacancy exists.
    expect(res.status).toBe(404);
  });
});

/** An identity-verified tutor account, which is what FR-13.4 requires. */
async function verifiedTutorCookie(): Promise<string> {
  const email = 'vacancy-tutor@example.test';
  const cookie = await loginAs(email, 'tutor', 'tutor-pass-123');
  const user = (await db.select().from(users).where(eq(users.email, email)))[0]!;
  await db.insert(tutorProfiles).values({
    id: newId(),
    userId: user.id,
    gender: 'female',
    cityId: 'karachi',
    slug: 'vacancy-tutor',
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    teachesAtHome: 1,
    createdAt: nowIso(),
  });
  return cookie;
}

describe('student progress ledger', () => {
  it('is readable by the owning parent and includes session notes plus verification data', async () => {
    const parentPassword = 'parent-pass-123';
    const tutorPassword = 'tutor-pass-123';
    const parentUserId = newId();
    const tutorUserId = newId();
    const studentProfileId = newId();
    const tutorProfileId = newId();
    const bookingId = newId();

    await db.insert(users).values([
      {
        id: parentUserId,
        email: 'ledger-parent@example.test',
        passwordHash: await hashPassword(parentPassword),
        role: 'parent',
        displayName: 'Ledger Parent',
        status: 'active',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      {
        id: tutorUserId,
        email: 'ledger-tutor@example.test',
        passwordHash: await hashPassword(tutorPassword),
        role: 'tutor',
        displayName: 'Ledger Tutor',
        gender: 'female',
        status: 'active',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    ]);

    await db.insert(studentProfiles).values({
      id: studentProfileId,
      parentUserId,
      name: 'Ledger Student',
      levelId: 'matric',
      boardId: 'sindh-board',
      dateOfBirth: '2012-01-01',
      createdAt: nowIso(),
    });

    await db.insert(tutorProfiles).values({
      id: tutorProfileId,
      userId: tutorUserId,
      gender: 'female',
      cityId: 'karachi',
      slug: 'ledger-tutor',
      profileStatus: SEARCHABLE_PROFILE_STATUS,
      teachesAtHome: 1,
      createdAt: nowIso(),
    });

    await db.insert(bookings).values({
      id: bookingId,
      tutorId: tutorProfileId,
      studentProfileId,
      requestedByUserId: parentUserId,
      engagementType: 'monthly',
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIdsJson: '["math-matric-sindh-quadratic-equations"]',
      mode: 'home',
      areaId: 'karachi-clifton',
      status: 'completed',
      completedAt: nowIso(),
      guardianPresenceRequired: 1,
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });

    await db.insert(sessionNotes).values({
      id: newId(),
      bookingId,
      tutorId: tutorProfileId,
      topicsCoveredJson: '["math-matric-sindh-quadratic-equations"]',
      masteryRatingsJson: '{"math-matric-sindh-quadratic-equations":4}',
      note: 'Good progress on quadratic equations.',
      createdAt: nowIso(),
    });

    await db.insert(verificationRecords).values({
      id: newId(),
      tutorId: tutorProfileId,
      track: 'identity',
      decision: 'approved',
      artefactsCheckedJson: '["cnic","degree"]',
      decidedBy: (await db.select().from(users).where(eq(users.role, 'admin')).limit(1))[0]!.id,
      decidedAt: nowIso(),
      reason: 'Checked CNIC and degree.',
      createdAt: nowIso(),
    });

    const parentRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ledger-parent@example.test', password: parentPassword });
    expect(parentRes.status).toBe(200);
    const parentCookie = cookiesOf(parentRes);

    const res = await request(app)
      .get(`/api/students/${studentProfileId}/progress`)
      .set('Cookie', parentCookie);

    expect(res.status).toBe(200);
    expect(res.body.ledger.studentProfileId).toBe(studentProfileId);
    expect(res.body.ledger.entries).toHaveLength(1);
    expect(res.body.ledger.entries[0].tutorVerification.artefactsChecked).toEqual(['cnic', 'degree']);

    // FR-12.2 — mastery per topic over time.
    expect(res.body.ledger.topics).toHaveLength(1);
    expect(res.body.ledger.topics[0].latestRating).toBe(4);

    // An administrator may read it too — a dispute cannot be investigated
    // otherwise, and the data model records session notes as parties-and-admin.
    const asAdmin = await request(app)
      .get(`/api/students/${studentProfileId}/progress`)
      .set('Cookie', adminCookie);
    expect(asAdmin.status).toBe(200);

    // Another family gets 404, not 403 — no existence oracle over student ids.
    const strangerCookie = await loginAs('stranger@example.test', 'parent', 'stranger-pass-123');
    const stranger = await request(app)
      .get(`/api/students/${studentProfileId}/progress`)
      .set('Cookie', strangerCookie);
    expect(stranger.status).toBe(404);

    // And the tutor who taught the session cannot read the ledger either.
    const tutorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ledger-tutor@example.test', password: tutorPassword });
    const asTutor = await request(app)
      .get(`/api/students/${studentProfileId}/progress`)
      .set('Cookie', cookiesOf(tutorLogin));
    expect(asTutor.status).toBe(404);
  });
});