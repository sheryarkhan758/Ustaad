/**
 * Payment records, end to end — §6.31.
 *
 * The scope boundary is the thing being tested as much as the behaviour: this
 * module **records** what was agreed and what both parties confirm was paid. It
 * does not process payments, hold funds, act as an escrow or move money.
 *
 * The five proofs the brief asks for: immutability after confirmation, both
 * acknowledgement paths, a dispute reaching administrator resolution, a third
 * party receiving 403, and a payment record having **zero** effect on any
 * ranking or statistic output.
 */

import fs from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../shared/db-values';
import { describeAcknowledgement, deriveStatus } from '../shared/payment-status';
import { normaliseHourlyAmount, rupeesToPaisa } from '../shared/rates';
import { searchQuerySchema } from '../shared/search';
import { createApp } from './app';
import { adminActions } from './db/schema/admin';
import { bookings } from './db/schema/booking';
import { rateBenchmarks, tutorReliability, tutorScores, tutorSearchSignals } from './db/schema/derived';
import { studentProfiles, users } from './db/schema/identity';
import { paymentDisputes, paymentRecords } from './db/schema/payment';
import { SEARCHABLE_PROFILE_STATUS, tutorProfiles, tutorRates } from './db/schema/tutor';
import { createSeededTestDb, type TestDb } from './db/test-db';
import { runAllMaterialisationJobs } from './jobs/index';
import { searchTutors } from './repositories/search';
import { buildEngagementStatement } from './services/payment-records';

const PASSWORD = 'a-sufficiently-long-password';
const MONTHLY = rupeesToPaisa(8000);
const TRAVEL = rupeesToPaisa(500);

let db: TestDb;
let app: ReturnType<typeof createApp>;

function cookiesOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw as string] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

async function registerAs(
  role: 'parent' | 'tutor' | 'student',
  email: string,
): Promise<{ cookie: string; userId: string }> {
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
  const userId = (await db.select().from(users).where(eq(users.email, email)))[0]!.id;
  return { cookie: cookiesOf(res), userId };
}

interface Engagement {
  familyCookie: string;
  familyUserId: string;
  tutorCookie: string;
  tutorUserId: string;
  tutorId: string;
  bookingId: string;
  adminCookie: string;
  adminUserId: string;
}

/** A confirmed monthly engagement, which is what creates a payment record. */
async function engagement(prefix: string): Promise<Engagement> {
  const family = await registerAs('parent', `${prefix}-family@example.test`);
  const tutor = await registerAs('tutor', `${prefix}-tutor@example.test`);

  const admin = await registerAs('parent', `${prefix}-admin@example.test`);
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.userId));
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: `${prefix}-admin@example.test`, password: PASSWORD });

  const tutorId = newId();
  await db.insert(tutorProfiles).values({
    id: tutorId,
    userId: tutor.userId,
    gender: 'female',
    cityId: 'karachi',
    slug: `${prefix}-slug`,
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    teachesAtHome: 1,
    willingAreasJson: '["karachi-gulshan-e-iqbal"]',
    createdAt: nowIso(),
  });

  await db.insert(tutorRates).values({
    id: newId(),
    tutorId,
    subjectId: 'mathematics',
    levelId: 'matric',
    rateType: 'monthly',
    amount: MONTHLY,
    currency: 'PKR',
    sessionsPerWeek: 3,
    minutesPerSession: 90,
    mode: 'home',
    negotiable: 0,
    travelCharge: TRAVEL,
    normalisedHourlyAmount: normaliseHourlyAmount({
      rateType: 'monthly',
      amount: MONTHLY,
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    }),
    createdAt: nowIso(),
  });

  const studentProfileId = newId();
  await db.insert(studentProfiles).values({
    id: studentProfileId,
    parentUserId: family.userId,
    name: 'A Student',
    gender: 'female',
    createdAt: nowIso(),
  });

  const bookingId = newId();
  await db.insert(bookings).values({
    id: bookingId,
    tutorId,
    studentProfileId,
    requestedByUserId: family.userId,
    engagementType: 'monthly',
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIdsJson: '[]',
    mode: 'home',
    slotStart: '2027-03-01T11:00:00.000Z',
    slotEnd: '2027-03-01T12:30:00.000Z',
    status: 'requested',
    requestedAt: nowIso(),
    createdAt: nowIso(),
  });

  // Confirmation is what creates the record (FR-31.1).
  const confirmed = await request(app)
    .post(`/api/bookings/${bookingId}/transition`)
    .set('Cookie', tutor.cookie)
    .send({ to: 'confirmed' });
  expect(confirmed.status).toBe(200);

  return {
    familyCookie: family.cookie,
    familyUserId: family.userId,
    tutorCookie: tutor.cookie,
    tutorUserId: tutor.userId,
    tutorId,
    bookingId,
    adminCookie: cookiesOf(adminLogin),
    adminUserId: admin.userId,
  };
}

async function recordIdFor(bookingId: string): Promise<string> {
  const rows = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.bookingId, bookingId));
  return rows[0]!.id;
}

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

/* =========================================================================
 * The boundary
 * ====================================================================== */

describe('the scope boundary', () => {
  it('states plainly on every payment response that no funds are handled', async () => {
    const fx = await engagement('boundary');

    const statement = await request(app)
      .get(`/api/payments/bookings/${fx.bookingId}`)
      .set('Cookie', fx.familyCookie);

    expect(statement.status).toBe(200);
    // FR-31.10, SEC-23: on the payload, not left to a front end to remember.
    expect(statement.body.disclaimer).toMatch(/does not process, hold or transfer money/i);
  });

  it('contains no gateway integration anywhere in the codebase', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'migrations' ? [] : walk(full);
        return entry.name.endsWith('.ts') ? [full] : [];
      });

    const banned =
      /\b(stripe|razorpay|paypal|payfast|jazzcash|easypaisa|braintree|adyen|checkout\.com)\b/i;

    for (const file of [...walk('server'), ...walk('shared')]) {
      if (file.endsWith('payments.flow.test.ts')) continue;
      const code = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} references a payment gateway`).not.toMatch(banned);
    }
  });

  it('models no balance, wallet, payout or refund', () => {
    const schema = fs.readFileSync('server/db/schema/payment.ts', 'utf8');
    for (const forbidden of ['balance', 'wallet', 'payout', 'refund', 'escrow', 'commission']) {
      // Named only in the prose that forbids them, never as a column.
      expect(schema.replace(/\/\*[\s\S]*?\*\//g, ''), forbidden).not.toMatch(
        new RegExp(`${forbidden}\\s*:`, 'i'),
      );
    }
  });
});

/* =========================================================================
 * 1. Creation at confirmation, snapshotted
 * ====================================================================== */

describe('a record is created at confirmation', () => {
  it('snapshots the agreed amount, travel charge, rate type and engagement type', async () => {
    const fx = await engagement('snapshot');

    const rows = await db
      .select()
      .from(paymentRecords)
      .where(eq(paymentRecords.bookingId, fx.bookingId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.agreedAmount).toBe(MONTHLY);
    // A separate recorded line, never folded into the rate (FR-31.2).
    expect(rows[0]!.travelCharge).toBe(TRAVEL);
    expect(rows[0]!.rateType).toBe('monthly');
    expect(rows[0]!.engagementType).toBe('monthly');
    expect(rows[0]!.cycleLabel).toBe('2027-03');
    expect(rows[0]!.status).toBe('pending');
  });

  it('is unaffected by a later change to the tutor\'s pricing', async () => {
    const fx = await engagement('frozen');
    const before = (await db.select().from(paymentRecords))[0]!.agreedAmount;

    await db.update(tutorRates).set({ amount: rupeesToPaisa(20_000) });

    const after = (await db.select().from(paymentRecords))[0]!.agreedAmount;
    // The whole point of a record: it captures the moment (§2.3).
    expect(after).toBe(before);
    expect(after).toBe(MONTHLY);
    expect(fx.bookingId).toBeTruthy();
  });

  it('creates nothing for a volunteer, who charges no fee', async () => {
    const fx = await engagement('volunteer');
    await db.delete(paymentRecords);
    await db.update(tutorProfiles).set({ volunteerFlag: 1 }).where(eq(tutorProfiles.id, fx.tutorId));

    const { createPaymentRecordOnConfirmation } = await import('./services/payment-records');
    const result = await createPaymentRecordOnConfirmation(db, fx.bookingId);

    expect(result.record).toBeNull();
    expect(result.skipped).toMatch(/volunteer/);
  });

  it('is idempotent — confirming twice does not create a second record', async () => {
    const fx = await engagement('idempotent');
    const { createPaymentRecordOnConfirmation } = await import('./services/payment-records');

    await createPaymentRecordOnConfirmation(db, fx.bookingId);
    await createPaymentRecordOnConfirmation(db, fx.bookingId);

    expect(await db.select().from(paymentRecords)).toHaveLength(1);
  });
});

/* =========================================================================
 * 2. Both acknowledgement paths — FR-31.3, FR-31.4
 * ====================================================================== */

describe('dual acknowledgement', () => {
  it('goes pending → family_marked → settled', async () => {
    const fx = await engagement('ack');
    const id = await recordIdFor(fx.bookingId);

    const marked = await request(app)
      .post(`/api/payments/${id}/mark-paid`)
      .set('Cookie', fx.familyCookie);
    expect(marked.status).toBe(200);
    expect(marked.body.record.status).toBe('family_marked');

    const confirmed = await request(app)
      .post(`/api/payments/${id}/confirm-received`)
      .set('Cookie', fx.tutorCookie);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.record.status).toBe('settled');
  });

  it('settles whichever order the two parties acknowledge in', async () => {
    const fx = await engagement('order');
    const id = await recordIdFor(fx.bookingId);

    const tutorFirst = await request(app)
      .post(`/api/payments/${id}/confirm-received`)
      .set('Cookie', fx.tutorCookie);
    expect(tutorFirst.status).toBe(200);
    // Not `family_marked`: the family has not marked anything, and putting that
    // claim in their mouth would misstate the record.
    expect(tutorFirst.body.record.status).toBe('pending');
    expect(tutorFirst.body.record.tutorConfirmedAt).not.toBeNull();

    const familySecond = await request(app)
      .post(`/api/payments/${id}/mark-paid`)
      .set('Cookie', fx.familyCookie);
    expect(familySecond.body.record.status).toBe('settled');
  });

  it('describes a one-sided claim as unconfirmed, whichever side made it', () => {
    const at = new Date();

    expect(
      describeAcknowledgement({ status: 'family_marked', familyMarkedPaidAt: at, tutorConfirmedAt: null })
        .summary,
    ).toMatch(/awaiting the tutor/i);

    expect(
      describeAcknowledgement({ status: 'pending', familyMarkedPaidAt: null, tutorConfirmedAt: at })
        .summary,
    ).toMatch(/awaiting the family/i);

    expect(
      describeAcknowledgement({ status: 'settled', familyMarkedPaidAt: at, tutorConfirmedAt: at })
        .settled,
    ).toBe(true);
  });

  it('will not let the family confirm receipt, nor the tutor mark it paid', async () => {
    const fx = await engagement('crossed');
    const id = await recordIdFor(fx.bookingId);

    const familyConfirming = await request(app)
      .post(`/api/payments/${id}/confirm-received`)
      .set('Cookie', fx.familyCookie);
    expect(familyConfirming.status).toBe(403);

    const tutorMarking = await request(app)
      .post(`/api/payments/${id}/mark-paid`)
      .set('Cookie', fx.tutorCookie);
    expect(tutorMarking.status).toBe(403);
  });

  it('refuses a duplicate acknowledgement from the same side', async () => {
    const fx = await engagement('dupe');
    const id = await recordIdFor(fx.bookingId);

    await request(app).post(`/api/payments/${id}/mark-paid`).set('Cookie', fx.familyCookie);
    const again = await request(app)
      .post(`/api/payments/${id}/mark-paid`)
      .set('Cookie', fx.familyCookie);

    expect(again.status).toBe(409);
  });

  it('keeps `disputed` sticky against a later acknowledgement', () => {
    const at = new Date();
    expect(
      deriveStatus({ status: 'disputed', familyMarkedPaidAt: at, tutorConfirmedAt: at }),
    ).toBe('disputed');
  });
});

/* =========================================================================
 * 3. Immutability after confirmation — FR-31.1
 * ====================================================================== */

describe('agreed_amount immutability', () => {
  it('may be amended while the record is still one-sided', async () => {
    const fx = await engagement('amend');
    const id = await recordIdFor(fx.bookingId);

    await request(app).post(`/api/payments/${id}/mark-paid`).set('Cookie', fx.familyCookie);

    const res = await request(app)
      .patch(`/api/payments/${id}`)
      .set('Cookie', fx.familyCookie)
      .send({ agreedAmount: rupeesToPaisa(9000) });

    expect(res.status).toBe(200);
    expect(res.body.record.agreedAmount).toBe(rupeesToPaisa(9000));
  });

  it('returns 409 on ANY attempt once both parties have confirmed', async () => {
    const fx = await engagement('immutable');
    const id = await recordIdFor(fx.bookingId);

    await request(app).post(`/api/payments/${id}/mark-paid`).set('Cookie', fx.familyCookie);
    await request(app).post(`/api/payments/${id}/confirm-received`).set('Cookie', fx.tutorCookie);

    for (const cookie of [fx.familyCookie, fx.tutorCookie, fx.adminCookie]) {
      const res = await request(app)
        .patch(`/api/payments/${id}`)
        .set('Cookie', cookie)
        .send({ agreedAmount: rupeesToPaisa(1) });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('agreed_amount_immutable');
    }

    // The figure both parties acknowledged is the figure that is stored.
    const stored = (await db.select().from(paymentRecords))[0]!;
    expect(stored.agreedAmount).toBe(MONTHLY);
  });

  it('returns 409 while the record is under dispute', async () => {
    const fx = await engagement('disputed-lock');
    const id = await recordIdFor(fx.bookingId);

    await request(app)
      .post(`/api/payments/${id}/disputes`)
      .set('Cookie', fx.tutorCookie)
      .send({ reason: 'not_received', detail: 'No payment reached me for August.' });

    const res = await request(app)
      .patch(`/api/payments/${id}`)
      .set('Cookie', fx.familyCookie)
      .send({ agreedAmount: rupeesToPaisa(1) });

    // An administrator resolving a disagreement about a figure must be looking
    // at the figure both parties were looking at.
    expect(res.status).toBe(409);
  });
});

/* =========================================================================
 * 4. A dispute reaching administrator resolution — FR-31.5 to FR-31.7
 * ====================================================================== */

describe('disputes', () => {
  it('runs from either party through to a recorded administrator resolution', async () => {
    const fx = await engagement('dispute');
    const id = await recordIdFor(fx.bookingId);

    const raised = await request(app)
      .post(`/api/payments/${id}/disputes`)
      .set('Cookie', fx.tutorCookie)
      .send({ reason: 'not_received', detail: 'The August fee never reached me.' });

    expect(raised.status).toBe(201);
    expect(raised.body.record.status).toBe('disputed');
    expect(raised.body.dispute.raisedByParty).toBe('tutor');

    // The administrator queue carries the full engagement record (FR-31.6).
    const queue = await request(app)
      .get('/api/payments/admin/disputes')
      .set('Cookie', fx.adminCookie);
    expect(queue.status).toBe(200);
    expect(queue.body.count).toBe(1);
    expect(queue.body.items[0].record.agreedAmount).toBe(MONTHLY);

    const resolved = await request(app)
      .post(`/api/payments/admin/disputes/${raised.body.dispute.id}/resolve`)
      .set('Cookie', fx.adminCookie)
      .send({
        outcome: 'settled',
        reason: 'Family produced a dated bank transfer receipt matching the agreed amount.',
      });

    expect(resolved.status).toBe(200);
    expect(resolved.body.record.status).toBe('settled');

    // FR-31.7: actor, timestamp and reasoning, permanently in the audit log.
    const entries = await db.select().from(adminActions);
    const logged = entries.find((e) => e.action === 'payment_dispute.resolved')!;
    expect(logged).toBeDefined();
    expect(logged.adminUserId).toBe(fx.adminUserId);
    expect(JSON.parse(logged.detailJson!).resolutionReason).toMatch(/bank transfer receipt/);
    expect(JSON.parse(logged.detailJson!).agreedAmount).toBe(MONTHLY);

    const dispute = (await db.select().from(paymentDisputes))[0]!;
    expect(dispute.status).toBe('resolved');
    expect(dispute.resolvedBy).toBe(fx.adminUserId);
  });

  it('requires a written reason to resolve', async () => {
    const fx = await engagement('noreason');
    const id = await recordIdFor(fx.bookingId);

    const raised = await request(app)
      .post(`/api/payments/${id}/disputes`)
      .set('Cookie', fx.familyCookie)
      .send({ reason: 'amount_disagreement' });

    const res = await request(app)
      .post(`/api/payments/admin/disputes/${raised.body.dispute.id}/resolve`)
      .set('Cookie', fx.adminCookie)
      .send({ outcome: 'settled', reason: 'ok' });

    expect(res.status).toBe(400);
  });

  it('refuses a non-administrator on the resolution route', async () => {
    const fx = await engagement('nonadmin');
    const id = await recordIdFor(fx.bookingId);

    const raised = await request(app)
      .post(`/api/payments/${id}/disputes`)
      .set('Cookie', fx.familyCookie)
      .send({ reason: 'amount_disagreement' });

    for (const cookie of [fx.familyCookie, fx.tutorCookie]) {
      const res = await request(app)
        .post(`/api/payments/admin/disputes/${raised.body.dispute.id}/resolve`)
        .set('Cookie', cookie)
        .send({ outcome: 'settled', reason: 'I say this is settled, so it is settled.' });
      expect(res.status).toBe(403);
    }
  });
});

/* =========================================================================
 * 5. Visibility — FR-31.11, SEC-22
 * ====================================================================== */

describe('visibility', () => {
  it('gives a THIRD PARTY 403 on every payment route', async () => {
    const fx = await engagement('visibility');
    const id = await recordIdFor(fx.bookingId);
    const stranger = await registerAs('parent', 'stranger@example.test');

    for (const [method, url] of [
      ['get', `/api/payments/bookings/${fx.bookingId}`],
      ['get', `/api/payments/${id}`],
      ['post', `/api/payments/${id}/mark-paid`],
      ['post', `/api/payments/${id}/confirm-received`],
      ['post', `/api/payments/${id}/disputes`],
      ['patch', `/api/payments/${id}`],
    ] as const) {
      const res = await request(app)[method](url).set('Cookie', stranger.cookie).send({});
      expect(res.status, `${method} ${url}`).toBe(403);
      // Nothing about the engagement leaks in the refusal.
      expect(JSON.stringify(res.body)).not.toContain(String(MONTHLY));
    }
  });

  it('admits both parties and administrators', async () => {
    const fx = await engagement('parties');

    for (const cookie of [fx.familyCookie, fx.tutorCookie, fx.adminCookie]) {
      const res = await request(app)
        .get(`/api/payments/bookings/${fx.bookingId}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
    }
  });

  it('refuses an anonymous caller', async () => {
    const fx = await engagement('anon');
    const res = await request(app).get(`/api/payments/bookings/${fx.bookingId}`);
    expect(res.status).toBe(401);
  });
});

/* =========================================================================
 * 6. Zero effect on ranking or any public statistic — FR-31.12, SEC-22
 * ====================================================================== */

describe('payment records have NO effect on ranking or any public statistic', () => {
  it('produces identical scores whether a payment is settled or disputed', async () => {
    const fx = await engagement('ranking');
    const id = await recordIdFor(fx.bookingId);

    // A fixed clock for both runs. Recency decays from `now`, and `computed_at`
    // is stamped per run — letting either vary would make this test pass or
    // fail on elapsed time rather than on the thing it is about.
    const at = new Date('2027-06-01T00:00:00.000Z');
    const stripTimestamps = (rows: unknown[]): string =>
      JSON.stringify(
        rows.map((row) => {
          const { computedAt, ...rest } = row as Record<string, unknown>;
          void computedAt;
          return rest;
        }),
      );

    await runAllMaterialisationJobs(db, at);
    const before = JSON.stringify(
      (await searchTutors(db, searchQuerySchema.parse({}))).results.map((r) => ({
        id: r.tutor.id,
        score: r.score,
        breakdown: r.breakdown,
      })),
    );
    const signalsBefore = stripTimestamps(await db.select().from(tutorSearchSignals));
    const reliabilityBefore = stripTimestamps(await db.select().from(tutorReliability));
    const scoresBefore = stripTimestamps(await db.select().from(tutorScores));
    const benchmarksBefore = stripTimestamps(await db.select().from(rateBenchmarks));

    // Settle one cycle and dispute another — the two extremes of the record.
    await request(app).post(`/api/payments/${id}/mark-paid`).set('Cookie', fx.familyCookie);
    await request(app).post(`/api/payments/${id}/confirm-received`).set('Cookie', fx.tutorCookie);

    await db.insert(paymentRecords).values({
      id: newId(),
      bookingId: fx.bookingId,
      cycleLabel: '2027-04',
      agreedAmount: MONTHLY,
      travelCharge: TRAVEL,
      rateType: 'monthly',
      engagementType: 'monthly',
      status: 'disputed',
      createdAt: nowIso(),
    });

    await runAllMaterialisationJobs(db, at);

    const after = JSON.stringify(
      (await searchTutors(db, searchQuerySchema.parse({}))).results.map((r) => ({
        id: r.tutor.id,
        score: r.score,
        breakdown: r.breakdown,
      })),
    );

    // Byte-identical. Allowing payment history to move a ranking would give a
    // tutor a reason to pressure a family over an acknowledgement, corrupting
    // the record the module exists to protect (FR-31.12, SEC-22).
    expect(after).toBe(before);
    expect(stripTimestamps(await db.select().from(tutorSearchSignals))).toBe(signalsBefore);
    expect(stripTimestamps(await db.select().from(tutorReliability))).toBe(reliabilityBefore);
    expect(stripTimestamps(await db.select().from(tutorScores))).toBe(scoresBefore);
    expect(stripTimestamps(await db.select().from(rateBenchmarks))).toBe(benchmarksBefore);
  });

  it('is not read by any ranking input, structurally', () => {
    // A behavioural test only covers the code that exists today. No module that
    // computes a public figure may even import the payment tables.
    const ranking = [
      'shared/ranking.ts',
      'server/repositories/search.ts',
      'server/jobs/tutor-scores.ts',
      'server/jobs/tutor-reliability.ts',
      'server/jobs/rate-benchmarks.ts',
    ];

    for (const file of ranking) {
      const code = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} reads payment data`).not.toMatch(/paymentRecords|paymentDisputes/);
      expect(code, `${file} imports the payment schema`).not.toMatch(/schema\/payment/);
    }
  });

  it('keeps the guard constant in place', async () => {
    const { PAYMENT_DATA_IS_NEVER_A_RANKING_INPUT } = await import('../shared/payment-status');
    expect(PAYMENT_DATA_IS_NEVER_A_RANKING_INPUT).toBe(true);
  });
});

/* =========================================================================
 * 7. The per-engagement history — FR-31.8
 * ====================================================================== */

describe('the engagement statement', () => {
  it('lists every cycle with its acknowledgements and totals', async () => {
    const fx = await engagement('statement');
    const first = await recordIdFor(fx.bookingId);

    await request(app).post(`/api/payments/${first}/mark-paid`).set('Cookie', fx.familyCookie);
    await request(app).post(`/api/payments/${first}/confirm-received`).set('Cookie', fx.tutorCookie);

    await db.insert(paymentRecords).values({
      id: newId(),
      bookingId: fx.bookingId,
      cycleLabel: '2027-04',
      agreedAmount: MONTHLY,
      travelCharge: TRAVEL,
      rateType: 'monthly',
      engagementType: 'monthly',
      status: 'pending',
      createdAt: nowIso(),
    });

    const statement = await buildEngagementStatement(db, fx.bookingId);

    expect(statement.lines).toHaveLength(2);
    expect(statement.lines.map((l) => l.cycleLabel)).toEqual(['2027-03', '2027-04']);

    // Only what BOTH parties confirmed counts as settled. A one-sided claim
    // must never be promoted into a fact by an aggregate.
    expect(statement.totalSettled).toBe(MONTHLY + TRAVEL);
    expect(statement.totalOutstanding).toBe(MONTHLY + TRAVEL);
    expect(statement.disclaimer).toMatch(/does not process, hold or transfer money/i);
  });

  it('shows a dispute against the cycle it concerns', async () => {
    const fx = await engagement('statement-dispute');
    const id = await recordIdFor(fx.bookingId);

    await request(app)
      .post(`/api/payments/${id}/disputes`)
      .set('Cookie', fx.familyCookie)
      .send({ reason: 'amount_disagreement', detail: 'We agreed 8,000 with no travel charge.' });

    const statement = await buildEngagementStatement(db, fx.bookingId);
    expect(statement.lines[0]!.disputes).toHaveLength(1);
    expect(statement.lines[0]!.disputes[0]!.reason).toBe('amount_disagreement');
    expect(statement.lines[0]!.status).toBe('disputed');
  });
});
