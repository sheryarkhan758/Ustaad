/**
 * Tutor onboarding, end to end through the API — §6.4, §6.5, §6.29.2.
 *
 * The headline test is `onboards a tutor completely and keeps her invisible
 * throughout`: register, profile, three differently-shaped rates, availability,
 * safety constraints, two documents, submit — checking after **every single
 * step** that search still returns nothing. A check only at the end would pass
 * even if the profile had been briefly visible in the middle.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { formatPaisa, rupeesToPaisa } from '../../shared/rates';
import { resolveUniqueSlug, slugifyName } from '../../shared/slug';
import { createApp } from '../app';
import { createSeededTestDb, type TestDb } from '../db/test-db';
import { searchQuerySchema } from '../../shared/search';
import { findSearchableTutorBySlug, searchTutors as runSearch } from '../repositories/search';

import { listTutorDocuments } from '../repositories/tutors';

async function searchTutors(database: TestDb): Promise<{ id: string; slug: string }[]> {
  const response = await runSearch(database, searchQuerySchema.parse({}));
  return response.results.map((r) => ({ id: r.tutor.id, slug: r.tutor.slug }));
}

const PASSWORD = 'a-sufficiently-long-password';

let db: TestDb;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

async function registerTutor(email: string, displayName = 'Ayesha Khan'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, role: 'tutor', displayName });
  expect(res.status).toBe(201);

  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw as string];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

/** Search must return nothing for this tutor. Called after every step. */
async function assertInvisible(slug: string, label: string): Promise<void> {
  const all = await searchTutors(db);
  expect(all.map((t) => t.slug), `visible in search after ${label}`).not.toContain(slug);
  expect(await findSearchableTutorBySlug(db, slug), `slug resolved after ${label}`).toBeNull();
}

/* =========================================================================
 * The whole walk
 * ====================================================================== */

describe('tutor onboarding', () => {
  it('onboards a tutor completely and keeps her invisible throughout', async () => {
    const cookie = await registerTutor('ayesha@example.test', 'Ayesha Khan');

    /* --- profile ---------------------------------------------------------- */
    const created = await request(app)
      .post('/api/tutors/profile')
      .set('Cookie', cookie)
      .send({
        gender: 'female',
        cityId: 'karachi',
        bio: 'FSc Mathematics and Physics. Home tuition for girls in Gulshan and Johar.',
        bioUr: 'ایف ایس سی ریاضی اور طبیعیات۔ گلشن اور جوہر میں لڑکیوں کے لیے گھر پر ٹیوشن۔',
        qualifications: 'BSc Mathematics, University of Karachi, 2019',
        experienceYears: 5,
        teachesAtHome: true,
        teachesOnline: true,
        willingAreaIds: ['karachi-gulshan-e-iqbal', 'karachi-gulistan-e-johar'],
      });

    expect(created.status).toBe(201);
    expect(created.body.profile.profileStatus).toBe('draft');
    expect(created.body.searchable).toBe(false);
    expect(created.body.profile.slug).toBe('ayesha-khan');
    // Urdu bio stored byte-for-byte (§2.10).
    expect(created.body.profile.bioUr).toContain('گلشن');

    const slug: string = created.body.profile.slug;
    await assertInvisible(slug, 'profile creation');

    /* --- three differently-shaped rates ----------------------------------- */
    const monthly = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        rateType: 'monthly',
        amount: rupeesToPaisa(8000),
        sessionsPerWeek: 3,
        minutesPerSession: 90,
        mode: 'home',
        negotiable: true,
        travelCharge: rupeesToPaisa(500),
      });
    expect(monthly.status).toBe(201);
    // §2.7's worked case: PKR 8,000/month for 3 × 90 min is PKR 410.26/hour.
    expect(monthly.body.rate.normalisedHourlyAmount).toBe(41_026);
    expect(formatPaisa(monthly.body.rate.normalisedHourlyAmount)).toBe('410.26');
    await assertInvisible(slug, 'monthly rate');

    const single = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        rateType: 'single_session',
        amount: rupeesToPaisa(1200),
        minutesPerSession: 90,
        mode: 'online',
        negotiable: false,
      });
    expect(single.status).toBe(201);
    // Never folded into the monthly reading, which would understate it 13×.
    expect(single.body.rate.normalisedHourlyAmount).toBe(80_000);
    await assertInvisible(slug, 'single-session rate');

    const group = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({
        subjectId: 'physics',
        levelId: 'intermediate',
        rateType: 'group_monthly',
        amount: rupeesToPaisa(14_000),
        perHeadAmount: rupeesToPaisa(3500),
        groupSizeMax: 4,
        sessionsPerWeek: 2,
        minutesPerSession: 120,
        mode: 'own_place',
        negotiable: true,
      });
    expect(group.status).toBe(201);
    // Per head, which is the figure a family compares against one-to-one.
    expect(group.body.rate.normalisedHourlyAmount).toBe(20_192);
    await assertInvisible(slug, 'group rate');

    const rates = await request(app).get('/api/tutors/rates').set('Cookie', cookie);
    expect(rates.body.rates).toHaveLength(3);

    /* --- subject claims --------------------------------------------------- */
    const claim = await request(app)
      .post('/api/tutors/claims')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        topicIds: [
          'math-matric-sindh-quadratic-equations',
          'math-matric-sindh-algebraic-factorisation',
        ],
      });

    expect(claim.status).toBe(201);
    // Asserted, not verified. Agent 2 has not tested anything (§2.2).
    expect(claim.body.claim.claimStatus).toBe('asserted');
    await assertInvisible(slug, 'subject claim');

    /* --- availability ----------------------------------------------------- */
    const slot = await request(app)
      .post('/api/tutors/availability')
      .set('Cookie', cookie)
      .send({
        weekday: 1,
        startTime: '16:00',
        endTime: '18:30',
        mode: 'home',
        areaId: 'karachi-gulshan-e-iqbal',
      });
    expect(slot.status).toBe(201);
    await assertInvisible(slug, 'availability');

    /* --- safety constraints — §6.29.2 ------------------------------------- */
    const safety = await request(app)
      .put('/api/tutors/safety')
      .set('Cookie', cookie)
      .send({
        femaleStudentsOnly: true,
        guardianPresenceRequired: true,
        restrictedAreaIds: ['karachi-malir', 'karachi-korangi'],
      });

    expect(safety.status).toBe(200);
    expect(safety.body.safety.femaleStudentsOnly).toBe(true);
    expect(safety.body.safety.guardianPresenceRequired).toBe(true);
    expect(safety.body.safety.restrictedAreaIds).toEqual(['karachi-malir', 'karachi-korangi']);
    await assertInvisible(slug, 'safety constraints');

    /* --- two documents ---------------------------------------------------- */
    for (const [docType, fileName, mimeType] of [
      ['cnic_front', 'cnic.jpg', 'image/jpeg'],
      ['degree', 'bsc-degree.pdf', 'application/pdf'],
    ] as const) {
      const ticket = await request(app)
        .post('/api/tutors/documents/ticket')
        .set('Cookie', cookie)
        .send({ docType, fileName, mimeType, sizeBytes: 512_000 });

      expect(ticket.status).toBe(201);
      expect(ticket.body.ticket.storagePath).toMatch(/^tutors\//);
      // A bucket key, never a public URL (SEC-7).
      expect(ticket.body.ticket.storagePath).not.toMatch(/^https?:/);
      expect(ticket.body.ticket.maxBytes).toBe(5 * 1024 * 1024);

      const confirmed = await request(app)
        .post('/api/tutors/documents')
        .set('Cookie', cookie)
        .send({ docType, storagePath: ticket.body.ticket.storagePath });

      expect(confirmed.status).toBe(201);
    }

    const stored = await listTutorDocuments(db, created.body.profile.id);
    expect(stored).toHaveLength(2);
    await assertInvisible(slug, 'documents');

    /* --- submit ----------------------------------------------------------- */
    const submitted = await request(app)
      .post('/api/tutors/profile/submit')
      .set('Cookie', cookie);

    expect(submitted.status).toBe(200);
    expect(submitted.body.profile.profileStatus).toBe('pending_verification');
    expect(submitted.body.searchable).toBe(false);

    // The requirement, stated as plainly as the brief states it: a
    // submitted-but-unapproved tutor is in no query used by search.
    await assertInvisible(slug, 'submission');
    expect(await searchTutors(db)).toEqual([]);
  });
});

/* =========================================================================
 * Slug collisions
 * ====================================================================== */

describe('slug generation', () => {
  it('suffixes a collision with a readable number', async () => {
    const first = await registerTutor('a1@example.test', 'Ayesha Khan');
    const second = await registerTutor('a2@example.test', 'Ayesha Khan');

    const body = { gender: 'female', cityId: 'karachi' };
    const one = await request(app).post('/api/tutors/profile').set('Cookie', first).send(body);
    const two = await request(app).post('/api/tutors/profile').set('Cookie', second).send(body);

    expect(one.body.profile.slug).toBe('ayesha-khan');
    // Readable enough to say over the phone, which is how this market shares.
    expect(two.body.profile.slug).toBe('ayesha-khan-2');
  });

  it('gives a neutral slug to a name with no Latin characters, rather than transliterating', async () => {
    const cookie = await registerTutor('urdu@example.test', 'عائشہ خان');
    const res = await request(app)
      .post('/api/tutors/profile')
      .set('Cookie', cookie)
      .send({ gender: 'female', cityId: 'karachi' });

    // Guessing at "aisha khan" would be inventing a spelling of someone's name.
    expect(slugifyName('عائشہ خان')).toBe('');
    expect(res.body.profile.slug).toBe('tutor');
  });

  it('never issues a reserved slug', async () => {
    const taken = new Set<string>();
    const slug = await resolveUniqueSlug('Admin', async (c) => taken.has(c));
    expect(slug).toBe('admin-2');
  });
});

/* =========================================================================
 * What these endpoints must refuse
 * ====================================================================== */

describe('onboarding refuses', () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await registerTutor('refuse@example.test', 'Refusal Tester');
    await request(app)
      .post('/api/tutors/profile')
      .set('Cookie', cookie)
      .send({ gender: 'female', cityId: 'karachi' });
  });

  it('a request body that tries to set profileStatus to approved', async () => {
    const res = await request(app)
      .patch('/api/tutors/profile')
      .set('Cookie', cookie)
      .send({ experienceYears: 3, profileStatus: 'approved' });

    expect(res.status).toBe(200);
    // The field is stripped by the schema; it does not exist to be set.
    expect(res.body.profile.profileStatus).toBe('draft');
    expect(res.body.searchable).toBe(false);
  });

  it('a claim that tries to declare itself verified', async () => {
    const res = await request(app)
      .post('/api/tutors/claims')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        topicIds: ['math-matric-sindh-quadratic-equations'],
        claimStatus: 'verified',
      });

    expect(res.status).toBe(201);
    expect(res.body.claim.claimStatus).toBe('asserted');
  });

  it('a rate that supplies its own normalised amount', async () => {
    const res = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({
        rateType: 'monthly',
        amount: rupeesToPaisa(8000),
        sessionsPerWeek: 3,
        minutesPerSession: 90,
        mode: 'home',
        normalisedHourlyAmount: 1,
      });

    expect(res.status).toBe(201);
    expect(res.body.rate.normalisedHourlyAmount).toBe(41_026);
  });

  it('a monthly rate missing its session fields', async () => {
    const res = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({ rateType: 'monthly', amount: rupeesToPaisa(8000), mode: 'home' });

    expect(res.status).toBe(400);
  });

  it('a travel charge on an online session', async () => {
    const res = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', cookie)
      .send({
        rateType: 'hourly',
        amount: rupeesToPaisa(900),
        mode: 'online',
        travelCharge: rupeesToPaisa(300),
      });

    expect(res.status).toBe(400);
  });

  it('an availability slot that overlaps one already saved', async () => {
    const body = { weekday: 3, startTime: '16:00', endTime: '18:00', mode: 'home' as const };
    expect((await request(app).post('/api/tutors/availability').set('Cookie', cookie).send(body)).status).toBe(201);

    const clash = await request(app)
      .post('/api/tutors/availability')
      .set('Cookie', cookie)
      .send({ ...body, startTime: '17:00', endTime: '19:00' });

    expect(clash.status).toBe(409);
  });

  it('an adjacent slot that only touches, which is not an overlap', async () => {
    await request(app)
      .post('/api/tutors/availability')
      .set('Cookie', cookie)
      .send({ weekday: 4, startTime: '09:00', endTime: '11:00', mode: 'home' });

    const adjacent = await request(app)
      .post('/api/tutors/availability')
      .set('Cookie', cookie)
      .send({ weekday: 4, startTime: '11:00', endTime: '13:00', mode: 'home' });

    expect(adjacent.status).toBe(201);
  });

  it('a document that is not JPG, PNG or PDF', async () => {
    const res = await request(app)
      .post('/api/tutors/documents/ticket')
      .set('Cookie', cookie)
      .send({
        docType: 'degree',
        fileName: 'payload.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: 1000,
      });

    expect(res.status).toBe(400);
  });

  it('a file whose extension disagrees with its declared type', async () => {
    const res = await request(app)
      .post('/api/tutors/documents/ticket')
      .set('Cookie', cookie)
      .send({
        docType: 'degree',
        fileName: 'payload.exe',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
      });

    expect(res.status).toBe(400);
  });

  it('a file over 5 MB', async () => {
    const res = await request(app)
      .post('/api/tutors/documents/ticket')
      .set('Cookie', cookie)
      .send({
        docType: 'cnic_front',
        fileName: 'cnic.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 6 * 1024 * 1024,
      });

    expect(res.status).toBe(400);
  });

  it('a storage path belonging to a different tutor', async () => {
    const res = await request(app)
      .post('/api/tutors/documents')
      .set('Cookie', cookie)
      .send({ docType: 'cnic_front', storagePath: 'tutors/somebody-else/cnic-front.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('path_not_yours');
  });

  it('a second profile for the same account', async () => {
    const res = await request(app)
      .post('/api/tutors/profile')
      .set('Cookie', cookie)
      .send({ gender: 'female', cityId: 'karachi' });

    expect(res.status).toBe(409);
  });

  it('a second submission once already pending', async () => {
    expect((await request(app).post('/api/tutors/profile/submit').set('Cookie', cookie)).status).toBe(200);
    const again = await request(app).post('/api/tutors/profile/submit').set('Cookie', cookie);
    expect(again.status).toBe(409);
  });
});

/* =========================================================================
 * Owner scoping
 * ====================================================================== */

describe('every endpoint is owner-scoped', () => {
  it('refuses a parent on every tutor route', async () => {
    const parent = await request(app)
      .post('/api/auth/register')
      .send({ email: 'parent@example.test', password: PASSWORD, role: 'parent', displayName: 'A Parent' });
    const raw = parent.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw as string]).map((c) => c.split(';')[0]).join('; ');

    for (const [method, path] of [
      ['post', '/api/tutors/profile'],
      ['get', '/api/tutors/profile'],
      ['get', '/api/tutors/rates'],
      ['post', '/api/tutors/rates'],
      ['get', '/api/tutors/claims'],
      ['put', '/api/tutors/safety'],
      ['get', '/api/tutors/documents'],
    ] as const) {
      const res = await request(app)[method](path).set('Cookie', cookie).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/tutors/profile');
    expect(res.status).toBe(401);
  });

  it('does not let one tutor touch another tutor\'s rate', async () => {
    const a = await registerTutor('owner-a@example.test', 'Owner A');
    const b = await registerTutor('owner-b@example.test', 'Owner B');

    for (const cookie of [a, b]) {
      await request(app)
        .post('/api/tutors/profile')
        .set('Cookie', cookie)
        .send({ gender: 'female', cityId: 'karachi' });
    }

    const rate = await request(app)
      .post('/api/tutors/rates')
      .set('Cookie', a)
      .send({ rateType: 'hourly', amount: rupeesToPaisa(900), mode: 'online' });
    expect(rate.status).toBe(201);

    // 404, not 403 — B must not learn that A's rate exists.
    const stolen = await request(app)
      .put(`/api/tutors/rates/${rate.body.rate.id}`)
      .set('Cookie', b)
      .send({ rateType: 'hourly', amount: rupeesToPaisa(1), mode: 'online' });
    expect(stolen.status).toBe(404);

    const deleted = await request(app)
      .delete(`/api/tutors/rates/${rate.body.rate.id}`)
      .set('Cookie', b);
    expect(deleted.status).toBe(404);

    // And A's rate is untouched.
    const stillThere = await request(app).get('/api/tutors/rates').set('Cookie', a);
    expect(stillThere.body.rates).toHaveLength(1);
    expect(stillThere.body.rates[0].amount).toBe(rupeesToPaisa(900));
  });
});
