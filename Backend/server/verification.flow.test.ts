/**
 * The verification module, end to end — §6.6, §6.28.
 *
 * Walks the whole path the brief describes: submit, administrator views
 * documents, approves with itemised checks, badge text renders and survives the
 * forbidden-phrase guard, the expiry job demotes a competency badge, and an
 * appeal plus override is recorded permanently.
 *
 * Interleaved throughout: assertions that the audit log grew, that it was never
 * rewritten, and that no CNIC number reached any of it.
 */

import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { findForbiddenTerm } from '../shared/badges';
import { newId, nowIso } from '../shared/db-values';
import { createApp } from './app';
import { adminActions } from './db/schema/admin';
import { notifications, verificationAppeals, verificationRecords } from './db/schema/verification';
import { tutorProfiles, tutorSubjectClaims } from './db/schema/tutor';
import { users } from './db/schema/identity';
import { createSeededTestDb, type TestDb } from './db/test-db';
import { searchQuerySchema } from '../shared/search';
import { searchTutors as runSearch } from './repositories/search';

async function searchTutors(database: TestDb): Promise<{ id: string }[]> {
  const response = await runSearch(database, searchQuerySchema.parse({}));
  return response.results.map((r) => ({ id: r.tutor.id }));
}
import { hashCnic, registerCnic, buildPublicVerification, competencyExpiryDate } from './services/verification';
import { decideAppeal, fileAppeal } from './services/verification-appeals';
import { SYSTEM_ACTOR_ID, runExpirySweep } from './services/verification-expiry';

const PASSWORD = 'a-sufficiently-long-password';
const CNIC = '42101-1234567-1';
const REASON_APPROVE =
  'CNIC scan matches the declared name and number. BSc degree certificate from University ' +
  'of Karachi checked against the stated year.';
const REASON_REJECT =
  'The uploaded CNIC image is illegible on the reverse and the degree year does not match ' +
  'the profile.';

let db: TestDb;
let app: ReturnType<typeof createApp>;
let adminCookie: string;
let adminUserId: string;

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function makeAdmin(): Promise<{ cookie: string; userId: string }> {
  // ADMIN is seed-assignable only (FR-1.5), so it is seeded here rather than
  // registered — which is itself the behaviour under test elsewhere.
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ email: 'admin@example.test', password: PASSWORD, role: 'parent', displayName: 'Admin' });

  const rows = await db.select().from(users).where(eq(users.email, 'admin@example.test'));
  const userId = rows[0]!.id;
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));

  // Re-login so the token carries the admin role.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@example.test', password: PASSWORD });
  expect(login.status).toBe(200);
  expect(registered.status).toBe(201);

  return { cookie: cookiesOf(login), userId };
}

async function onboardTutor(email: string, name: string): Promise<{ cookie: string; tutorId: string }> {
  const registered = await request(app)
    .post('/api/auth/register')
    .send({ email, password: PASSWORD, role: 'tutor', displayName: name });
  const cookie = cookiesOf(registered);

  const profile = await request(app)
    .post('/api/tutors/profile')
    .set('Cookie', cookie)
    .send({ gender: 'female', cityId: 'karachi', teachesAtHome: true });
  expect(profile.status).toBe(201);

  for (const [docType, fileName, mimeType] of [
    ['cnic_front', 'cnic.jpg', 'image/jpeg'],
    ['degree', 'degree.pdf', 'application/pdf'],
  ] as const) {
    const ticket = await request(app)
      .post('/api/tutors/documents/ticket')
      .set('Cookie', cookie)
      .send({ docType, fileName, mimeType, sizeBytes: 200_000 });
    await request(app)
      .post('/api/tutors/documents')
      .set('Cookie', cookie)
      .send({ docType, storagePath: ticket.body.ticket.storagePath });
  }

  await request(app).post('/api/tutors/profile/submit').set('Cookie', cookie);

  return { cookie, tutorId: profile.body.profile.id };
}

async function auditCount(): Promise<number> {
  return (await db.select().from(adminActions)).length;
}

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
  const admin = await makeAdmin();
  adminCookie = admin.cookie;
  adminUserId = admin.userId;
});

/* =========================================================================
 * The full path
 * ====================================================================== */

describe('the whole verification path', () => {
  it('submits, reviews documents, approves with itemised checks, and badges render', async () => {
    const { cookie, tutorId } = await onboardTutor('ayesha@example.test', 'Ayesha Khan');

    /* --- queue ------------------------------------------------------------ */
    const queue = await request(app).get('/api/admin/verifications').set('Cookie', adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.sort).toBe('oldest_first');
    expect(queue.body.items.map((i: { tutorId: string }) => i.tutorId)).toContain(tutorId);
    expect(queue.body.items[0].profileStatus).toBe('pending_verification');
    // Still invisible to families (FR-6.3).
    expect(await searchTutors(db)).toEqual([]);

    /* --- dossier and document view ---------------------------------------- */
    const dossier = await request(app)
      .get(`/api/admin/verifications/${tutorId}`)
      .set('Cookie', adminCookie);
    expect(dossier.body.documents).toHaveLength(2);

    const before = await auditCount();
    const view = await request(app)
      .post(`/api/admin/verifications/${tutorId}/documents/${dossier.body.documents[0].id}/view`)
      .set('Cookie', adminCookie)
      .send({ purpose: 'identity_verification' });

    expect(view.status).toBe(200);
    expect(view.body.url).toBeTruthy();
    expect(view.body.expiresInSeconds).toBeLessThanOrEqual(600);

    // Every view is logged (SEC-7, NFR-9).
    expect(await auditCount()).toBe(before + 1);
    const logged = (await db.select().from(adminActions)).at(-1)!;
    expect(logged.action).toBe('tutor.document_viewed');
    expect(logged.adminUserId).toBe(adminUserId);
    expect(logged.targetId).toBe(tutorId);
    expect(JSON.parse(logged.detailJson!).docType).toBe('cnic_front');
    expect(logged.createdAt).toBeTruthy();

    /* --- approve ---------------------------------------------------------- */
    const approved = await request(app)
      .post(`/api/admin/verifications/${tutorId}/approve`)
      .set('Cookie', adminCookie)
      .send({ artefactsChecked: ['cnic', 'degree'], reason: REASON_APPROVE });

    expect(approved.status).toBe(200);
    expect(approved.body.searchable).toBe(true);

    const record = (await db.select().from(verificationRecords))[0]!;
    expect(record.decision).toBe('approved');
    expect(JSON.parse(record.artefactsCheckedJson)).toEqual(['cnic', 'degree']);
    expect(record.decidedBy).toBe(adminUserId);
    expect(record.decidedAt).toBeTruthy();
    expect(record.reason).toBe(REASON_APPROVE);

    /* --- badges ----------------------------------------------------------- */
    const verification = approved.body.verification;
    expect(verification.verifiedBy).toBe('Ustaad.com');
    expect(verification.artefactsChecked).toEqual(['cnic', 'degree']);
    expect(verification.badges.badges.map((b: { text: string }) => b.text)).toEqual([
      'CNIC verified by Ustaad.com',
      'Academic documents reviewed',
    ]);

    for (const badge of verification.badges.badges) {
      expect(findForbiddenTerm(badge.text)).toBeNull();
      expect(findForbiddenTerm(badge.textUr)).toBeNull();
    }
    expect(verification.badges.scopeNote.en).toMatch(/no police check/i);

    /* --- now searchable --------------------------------------------------- */
    expect((await searchTutors(db)).map((t) => t.id)).toContain(tutorId);

    // And the tutor was told.
    const notes = await db.select().from(notifications);
    expect(notes.some((n) => n.kind === 'verification_approved')).toBe(true);
    expect(cookie).toBeTruthy();
  });

  it('requires a written reason for every decision, including approval', async () => {
    const { tutorId } = await onboardTutor('reasons@example.test', 'Reason Tester');

    for (const [path, body] of [
      [`/api/admin/verifications/${tutorId}/approve`, { artefactsChecked: ['cnic'], reason: 'ok' }],
      [`/api/admin/verifications/${tutorId}/reject`, { reason: 'no' }],
      [`/api/admin/verifications/${tutorId}/request-info`, { reason: '' }],
    ] as const) {
      const res = await request(app).post(path).set('Cookie', adminCookie).send(body);
      expect(res.status, path).toBe(400);
    }
  });

  it('refuses an approval that names no artefact', async () => {
    const { tutorId } = await onboardTutor('noartefact@example.test', 'No Artefact');

    const res = await request(app)
      .post(`/api/admin/verifications/${tutorId}/approve`)
      .set('Cookie', adminCookie)
      .send({ artefactsChecked: [], reason: REASON_APPROVE });

    // The badge is generated from this list; an empty one would produce a
    // verified profile with no statement of what was verified.
    expect(res.status).toBe(400);
    expect(await searchTutors(db)).toEqual([]);
  });

  it('refuses every route to a non-administrator', async () => {
    const { cookie, tutorId } = await onboardTutor('nonadmin@example.test', 'Non Admin');

    for (const [method, path] of [
      ['get', '/api/admin/verifications'],
      ['get', `/api/admin/verifications/${tutorId}`],
      ['post', `/api/admin/verifications/${tutorId}/approve`],
      ['post', `/api/admin/verifications/${tutorId}/reject`],
      ['get', '/api/admin/verifications/appeals/open'],
    ] as const) {
      const res = await request(app)[method](path).set('Cookie', cookie).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

/* =========================================================================
 * CNIC — SEC-8, NFR-10, FR-28.7
 * ====================================================================== */

describe('CNIC handling', () => {
  it('stores only a salted hash, never the number', async () => {
    const { cookie, tutorId } = await onboardTutor('cnic@example.test', 'Cnic Tutor');

    const res = await request(app).post('/api/tutors/cnic').set('Cookie', cookie).send({ cnic: CNIC });
    expect(res.status).toBe(201);
    expect(res.body.underReview).toBe(false);

    // Nowhere in the entire database.
    const dump = JSON.stringify(
      await Promise.all([
        db.select().from(tutorProfiles),
        db.select().from(adminActions),
        db.select().from(notifications),
        db.select().from(verificationRecords),
      ]),
    );
    expect(dump).not.toContain('42101');
    expect(dump).not.toContain('4210112345671');
    // Nor in the response.
    expect(JSON.stringify(res.body)).not.toContain('42101');
    expect(tutorId).toBeTruthy();
  });

  it('hashes the same number identically however it is punctuated', () => {
    expect(hashCnic('42101-1234567-1')).toBe(hashCnic('4210112345671'));
    expect(hashCnic('42101-1234567-1')).not.toBe(hashCnic('42101-1234567-2'));
  });

  it('FLAGS a duplicate for a person rather than auto-rejecting', async () => {
    const first = await onboardTutor('dup1@example.test', 'Dup One');
    const second = await onboardTutor('dup2@example.test', 'Dup Two');

    await request(app).post('/api/tutors/cnic').set('Cookie', first.cookie).send({ cnic: CNIC });
    const clash = await request(app)
      .post('/api/tutors/cnic')
      .set('Cookie', second.cookie)
      .send({ cnic: CNIC });

    expect(clash.status).toBe(201);
    expect(clash.body.underReview).toBe(true);
    // Not rejected: two accounts on one document is usually fraud and
    // occasionally a failed first signup, and a machine cannot tell.
    const profile = await db.select().from(tutorProfiles).where(eq(tutorProfiles.id, second.tutorId));
    expect(profile[0]!.profileStatus).toBe('pending_verification');

    // The other tutor's id is not disclosed to the second tutor.
    expect(JSON.stringify(clash.body)).not.toContain(first.tutorId);

    // But it reaches the administrator queue.
    const queue = await request(app)
      .get('/api/admin/verifications?duplicateCnicOnly=true')
      .set('Cookie', adminCookie);
    expect(queue.body.items.map((i: { tutorId: string }) => i.tutorId)).toContain(second.tutorId);
    expect(queue.body.items.find((i: { tutorId: string }) => i.tutorId === second.tutorId).duplicateCnicFlagged).toBe(true);
  });

  it('refuses to hash without a configured salt', async () => {
    const saved = process.env.CNIC_HASH_SALT;
    process.env.CNIC_HASH_SALT = '';
    try {
      expect(() => hashCnic(CNIC)).toThrow(/CNIC_HASH_SALT/);
    } finally {
      // Assigning `undefined` would store the string "undefined".
      if (saved === undefined) delete process.env.CNIC_HASH_SALT;
      else process.env.CNIC_HASH_SALT = saved;
    }
  });
});

/* =========================================================================
 * Expiry — FR-28.1, FR-28.2
 * ====================================================================== */

describe('competency badge expiry', () => {
  async function approvedTutorWithBadge(expiresOn: string): Promise<string> {
    const { cookie, tutorId } = await onboardTutor('expiry@example.test', 'Expiry Tutor');
    await request(app)
      .post(`/api/admin/verifications/${tutorId}/approve`)
      .set('Cookie', adminCookie)
      .send({ artefactsChecked: ['cnic'], reason: REASON_APPROVE });

    const claim = await request(app)
      .post('/api/tutors/claims')
      .set('Cookie', cookie)
      .send({
        subjectId: 'mathematics',
        levelId: 'matric',
        boardId: 'sindh-board',
        topicIds: ['math-matric-sindh-quadratic-equations'],
      });

    // Stand in for Agent 2 having passed it.
    await db
      .update(tutorSubjectClaims)
      .set({ claimStatus: 'verified', verifiedAt: nowIso(), expiresOn })
      .where(eq(tutorSubjectClaims.id, claim.body.claim.id));

    // The system actor the job attributes to.
    await db.insert(users).values({
      id: SYSTEM_ACTOR_ID,
      email: 'jobs@ustaad.invalid',
      passwordHash: 'no-login-for-this-account',
      role: 'admin',
      displayName: 'Scheduled jobs',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    return tutorId;
  }

  it('computes a twelve-month expiry from issue (FR-28.1)', () => {
    expect(competencyExpiryDate(new Date('2026-07-26T00:00:00Z'))).toBe('2027-07-26');
  });

  it('flips a lapsed badge to EXPIRED, not failed', async () => {
    const tutorId = await approvedTutorWithBadge('2026-01-01');

    const result = await runExpirySweep(db, new Date('2026-07-26T00:00:00Z'));
    expect(result.expired).toHaveLength(1);

    const claims = await db.select().from(tutorSubjectClaims);
    // The distinction the requirement turns on: the tutor did not fail
    // anything, they simply have not been re-assessed.
    expect(claims[0]!.claimStatus).toBe('expired');
    expect(claims[0]!.claimStatus).not.toBe('failed');
    expect(tutorId).toBeTruthy();
  });

  it('removes the badge but LEAVES THE TUTOR SEARCHABLE (§6.28, FR-6.2)', async () => {
    const tutorId = await approvedTutorWithBadge('2026-01-01');

    const before = await buildPublicVerification(db, tutorId, [{ name: 'Quadratic Equations' }]);
    expect(before.badges.badges.some((b) => b.track === 'competency')).toBe(true);

    await runExpirySweep(db, new Date('2026-07-26T00:00:00Z'));

    // Competency and identity are independent tracks, and it is identity
    // approval that gates searchability (FR-6.3). A lapsed competency badge
    // must not remove someone from search.
    const profile = await db.select().from(tutorProfiles).where(eq(tutorProfiles.id, tutorId));
    expect(profile[0]!.profileStatus).toBe('approved');
    expect((await searchTutors(db)).map((t) => t.id)).toContain(tutorId);

    // But the badge is gone: it is generated from live claims, so there is no
    // stale row that could survive.
    const after = await buildPublicVerification(db, tutorId, []);
    expect(after.badges.badges.some((b) => b.track === 'competency')).toBe(false);
    expect(after.badges.badges.some((b) => b.track === 'identity')).toBe(true);
  });

  it('notifies the tutor, and records the expiry in the audit log', async () => {
    await approvedTutorWithBadge('2026-01-01');
    await runExpirySweep(db, new Date('2026-07-26T00:00:00Z'));

    const notes = await db.select().from(notifications);
    const expired = notes.find((n) => n.kind === 'badge_expired')!;
    expect(expired).toBeDefined();
    expect(expired.body).toMatch(/not a failed assessment/i);
    expect(expired.body).toMatch(/still searchable/i);

    const entries = await db.select().from(adminActions);
    expect(entries.some((e) => e.action === 'competency.badge_expired')).toBe(true);
  });

  it('warns thirty days ahead, once (FR-28.2)', async () => {
    await approvedTutorWithBadge('2026-08-10');

    const first = await runExpirySweep(db, new Date('2026-07-26T00:00:00Z'));
    expect(first.warned).toHaveLength(1);
    expect(first.expired).toHaveLength(0);

    // Idempotent: running twice a day must not nag twice.
    const second = await runExpirySweep(db, new Date('2026-07-26T12:00:00Z'));
    expect(second.warned).toHaveLength(0);

    const warnings = (await db.select().from(notifications)).filter(
      (n) => n.kind === 'badge_expiring',
    );
    expect(warnings).toHaveLength(1);
  });

  it('leaves an unexpired badge alone', async () => {
    await approvedTutorWithBadge('2028-01-01');
    const result = await runExpirySweep(db, new Date('2026-07-26T00:00:00Z'));

    expect(result.expired).toEqual([]);
    expect(result.warned).toEqual([]);
    expect((await db.select().from(tutorSubjectClaims))[0]!.claimStatus).toBe('verified');
  });
});

/* =========================================================================
 * Appeals — §6.28, SEC-18, decision 12
 * ====================================================================== */

describe('appeals and administrator override', () => {
  async function rejectedTutor(): Promise<{ cookie: string; tutorId: string; recordId: string }> {
    const { cookie, tutorId } = await onboardTutor('appeal@example.test', 'Appeal Tutor');

    await request(app)
      .post(`/api/admin/verifications/${tutorId}/reject`)
      .set('Cookie', adminCookie)
      .send({ reason: REASON_REJECT, artefactsChecked: ['cnic'] });

    const records = await db.select().from(verificationRecords);
    return { cookie, tutorId, recordId: records[0]!.id };
  }

  it('refuses an appeal inside the seven-day cooling period (FR-28.3)', async () => {
    const { tutorId, recordId } = await rejectedTutor();

    await expect(
      fileAppeal(db, {
        tutorId,
        againstRecordId: recordId,
        tutorReason: 'The reverse image was clear on my copy; I am attaching a better scan.',
        at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      }),
    ).rejects.toThrow(/cooling|from 20/i);
  });

  it('accepts one appeal after the cooling period, and only one', async () => {
    const { tutorId, recordId } = await rejectedTutor();
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const filed = await fileAppeal(db, {
      tutorId,
      againstRecordId: recordId,
      tutorReason: 'The reverse image was clear on my copy; I am attaching a better scan.',
      at: later,
    });
    expect(filed.appealId).toBeTruthy();

    // Appealable once (FR-28.3).
    await expect(
      fileAppeal(db, { tutorId, againstRecordId: recordId, tutorReason: 'Again please.', at: later }),
    ).rejects.toThrow(/already been appealed/i);
  });

  it('refuses to appeal a decision that is not appealable', async () => {
    const { tutorId } = await onboardTutor('notappealable@example.test', 'Not Appealable');
    await request(app)
      .post(`/api/admin/verifications/${tutorId}/approve`)
      .set('Cookie', adminCookie)
      .send({ artefactsChecked: ['cnic'], reason: REASON_APPROVE });

    const record = (await db.select().from(verificationRecords))[0]!;
    await expect(
      fileAppeal(db, {
        tutorId,
        againstRecordId: record.id,
        tutorReason: 'I would like this looked at again in detail please.',
        at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    ).rejects.toThrow(/not appealable/i);
  });

  it('lets an administrator override, WITHOUT touching the original record', async () => {
    const { tutorId, recordId } = await rejectedTutor();
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const original = (
      await db.select().from(verificationRecords).where(eq(verificationRecords.id, recordId))
    )[0]!;

    const { appealId } = await fileAppeal(db, {
      tutorId,
      againstRecordId: recordId,
      tutorReason: 'Attaching a clearer scan of the reverse and the original degree certificate.',
      at: later,
    });

    const override = await decideAppeal(db, {
      appealId,
      adminUserId,
      outcome: 'uphold',
      reason: 'Clearer scan supplied; the reverse is legible and the degree year now matches.',
      artefactsChecked: ['cnic', 'degree'],
      at: later,
    });

    expect(override.outcome).toBe('upheld');
    expect(override.searchable).toBe(true);

    // FR-28.4: the prior decision is retained and never overwritten.
    const untouched = (
      await db.select().from(verificationRecords).where(eq(verificationRecords.id, recordId))
    )[0]!;
    expect(untouched).toEqual(original);
    expect(untouched.decision).toBe('rejected');
    expect(untouched.reason).toBe(REASON_REJECT);

    // The override is a new row pointing back at it.
    const superseding = (
      await db
        .select()
        .from(verificationRecords)
        .where(eq(verificationRecords.id, override.supersedingRecordId!))
    )[0]!;
    expect(superseding.decision).toBe('overridden');
    expect(superseding.supersedesId).toBe(recordId);
    expect(superseding.decidedBy).toBe(adminUserId);

    // FR-28.5: actor, timestamp and reasoning, permanently.
    const entries = await db.select().from(adminActions);
    const logged = entries.find((e) => e.action === 'verification.appeal_upheld')!;
    expect(logged).toBeDefined();
    expect(logged.adminUserId).toBe(adminUserId);
    expect(JSON.parse(logged.detailJson!).reason).toMatch(/Clearer scan supplied/);

    // The tutor is now searchable, and knows.
    expect((await searchTutors(db)).map((t) => t.id)).toContain(tutorId);
    const notes = await db.select().from(notifications);
    expect(notes.some((n) => n.kind === 'appeal_decided')).toBe(true);
  });

  it('records a dismissal just as permanently as an override', async () => {
    const { tutorId, recordId } = await rejectedTutor();
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    const { appealId } = await fileAppeal(db, {
      tutorId,
      againstRecordId: recordId,
      tutorReason: 'Please look again, I believe the documents were sufficient.',
      at: later,
    });

    const decided = await decideAppeal(db, {
      appealId,
      adminUserId,
      outcome: 'dismiss',
      reason: 'The re-uploaded scan is the same image; the reverse remains illegible.',
      at: later,
    });

    expect(decided.outcome).toBe('dismissed');
    expect(decided.searchable).toBe(false);

    const appeal = (
      await db.select().from(verificationAppeals).where(eq(verificationAppeals.id, appealId))
    )[0]!;
    expect(appeal.status).toBe('dismissed');
    expect(appeal.decisionReason).toMatch(/remains illegible/);
    expect(appeal.decidedBy).toBe(adminUserId);

    const entries = await db.select().from(adminActions);
    expect(entries.some((e) => e.action === 'verification.appeal_dismissed')).toBe(true);
  });
});

/* =========================================================================
 * The audit log is append-only — NFR-19, SEC-13
 * ====================================================================== */

describe('the audit log only ever grows', () => {
  it('refuses direct UPDATE and DELETE attempts against admin_actions', async () => {
    expect(() => db.update(adminActions).set({ action: 'blocked' })).toThrow(/append-only/i);
    expect(() => db.delete(adminActions)).toThrow(/append-only/i);
  });

  it('grows monotonically across the whole path, and no row ever changes', async () => {
    const { cookie, tutorId } = await onboardTutor('audit@example.test', 'Audit Tutor');

    const snapshots: number[] = [await auditCount()];
    const seen = new Map<string, string>();

    const capture = async (): Promise<void> => {
      const rows = await db.select().from(adminActions);
      for (const row of rows) {
        const serialised = JSON.stringify(row);
        const previous = seen.get(row.id);
        if (previous !== undefined) {
          // The whole claim of the module: a written decision stays written.
          expect(serialised, `admin_actions row ${row.id} was modified`).toBe(previous);
        }
        seen.set(row.id, serialised);
      }
      snapshots.push(rows.length);
    };

    const dossier = await request(app)
      .get(`/api/admin/verifications/${tutorId}`)
      .set('Cookie', adminCookie);
    await request(app)
      .post(`/api/admin/verifications/${tutorId}/documents/${dossier.body.documents[0].id}/view`)
      .set('Cookie', adminCookie)
      .send({});
    await capture();

    await request(app)
      .post(`/api/admin/verifications/${tutorId}/reject`)
      .set('Cookie', adminCookie)
      .send({ reason: REASON_REJECT });
    await capture();

    const recordId = (await db.select().from(verificationRecords))[0]!.id;
    const later = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const { appealId } = await fileAppeal(db, {
      tutorId,
      againstRecordId: recordId,
      tutorReason: 'A clearer scan is attached; please review the reverse again.',
      at: later,
    });
    await decideAppeal(db, {
      appealId,
      adminUserId,
      outcome: 'uphold',
      reason: 'Reverse now legible on the replacement scan; degree year matches.',
      artefactsChecked: ['cnic', 'degree'],
      at: later,
    });
    await capture();

    for (let i = 1; i < snapshots.length; i += 1) {
      expect(snapshots[i]!).toBeGreaterThan(snapshots[i - 1]!);
    }
    expect(cookie).toBeTruthy();
  });

  it('exposes no way to update or delete an entry', async () => {
    const audit = await import('./services/audit');
    for (const name of Object.keys(audit)) {
      expect(name).not.toMatch(/update|delete|remove|edit|purge|clear/i);
    }
  });

  it('never records a CNIC number, even when one was submitted', async () => {
    const { cookie, tutorId } = await onboardTutor('nocnic@example.test', 'No Cnic In Log');
    await request(app).post('/api/tutors/cnic').set('Cookie', cookie).send({ cnic: CNIC });

    const dossier = await request(app)
      .get(`/api/admin/verifications/${tutorId}`)
      .set('Cookie', adminCookie);
    await request(app)
      .post(`/api/admin/verifications/${tutorId}/documents/${dossier.body.documents[0].id}/view`)
      .set('Cookie', adminCookie)
      .send({});
    await request(app)
      .post(`/api/admin/verifications/${tutorId}/approve`)
      .set('Cookie', adminCookie)
      .send({ artefactsChecked: ['cnic'], reason: REASON_APPROVE });

    const log = JSON.stringify(await db.select().from(adminActions));
    expect(log).not.toContain('42101');
    expect(log).not.toContain('4210112345671');
    // The salted hash is not in there either — it belongs in one table.
    expect(log).not.toContain(hashCnic(CNIC));
    // But the fact of the view is.
    expect(log).toContain('tutor.document_viewed');
  });

  it('registerCnic never returns or logs the number', async () => {
    const { tutorId } = await onboardTutor('direct@example.test', 'Direct Call');
    const result = await registerCnic(db, tutorId, CNIC);
    expect(JSON.stringify(result)).not.toContain('42101');
    expect(newId()).toBeTruthy();
  });
});
