import { beforeEach, describe, expect, it } from 'vitest';

import { PaymentImmutabilityError, PaymentStateError } from '../../shared/payment-status';
import { createBookingFixture, createSeededTestDb, type TestDb } from '../db/test-db';
import {
  amendAgreedAmount,
  confirmReceivedByTutor,
  countOpenDisputesRaisedBy,
  createPaymentRecord,
  markPaidByFamily,
  raiseDispute,
} from './payments';

const PKR_8000 = 800_000; // paisa
const PKR_9000 = 900_000;

let db: TestDb;
let fixture: Awaited<ReturnType<typeof createBookingFixture>> & { adminUserId: string };

beforeEach(async () => {
  db = await createSeededTestDb();
  fixture = (await createBookingFixture(db)) as typeof fixture;
});

async function newRecord() {
  return createPaymentRecord(db, {
    bookingId: fixture.bookingId,
    cycleLabel: '2026-08',
    agreedAmount: PKR_8000,
    travelCharge: 50_000,
    rateType: 'monthly',
    engagementType: 'monthly',
  });
}

describe('payment record lifecycle', () => {
  it('starts pending, with neither party having acknowledged', async () => {
    const record = await newRecord();
    expect(record.status).toBe('pending');
    expect(record.familyMarkedPaidAt).toBeNull();
    expect(record.tutorConfirmedAt).toBeNull();
    expect(record.agreedAmount).toBe(PKR_8000);
  });

  it('treats a single-party claim as unconfirmed, not settled (FR-31.4)', async () => {
    const record = await newRecord();
    const marked = await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));

    expect(marked.status).toBe('family_marked');
    expect(marked.status).not.toBe('settled');
    expect(marked.tutorConfirmedAt).toBeNull();
  });

  it('settles only when both parties have acknowledged (FR-31.4)', async () => {
    const record = await newRecord();
    await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));
    const settled = await confirmReceivedByTutor(db, record.id, new Date('2026-08-05T18:00:00Z'));

    expect(settled.status).toBe('settled');
    expect(settled.familyMarkedPaidAt).not.toBeNull();
    expect(settled.tutorConfirmedAt).not.toBeNull();
  });

  it('settles regardless of which party acknowledges first', async () => {
    const record = await newRecord();
    await confirmReceivedByTutor(db, record.id, new Date('2026-08-05T09:00:00Z'));
    const settled = await markPaidByFamily(db, record.id, new Date('2026-08-05T11:00:00Z'));

    expect(settled.status).toBe('settled');
  });

  it('refuses a duplicate acknowledgement from the same party', async () => {
    const record = await newRecord();
    await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));

    await expect(markPaidByFamily(db, record.id, new Date('2026-08-06T10:00:00Z'))).rejects.toThrow(
      PaymentStateError,
    );
  });
});

describe('agreed_amount immutability — FR-31.1', () => {
  it('may be amended while the record is still pending', async () => {
    const record = await newRecord();
    const amended = await amendAgreedAmount(db, record.id, PKR_9000);

    expect(amended.agreedAmount).toBe(PKR_9000);
  });

  it('may still be amended after only one party has acknowledged', async () => {
    const record = await newRecord();
    await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));
    const amended = await amendAgreedAmount(db, record.id, PKR_9000);

    expect(amended.agreedAmount).toBe(PKR_9000);
  });

  it('is IMMUTABLE once both parties have confirmed', async () => {
    const record = await newRecord();
    await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));
    await confirmReceivedByTutor(db, record.id, new Date('2026-08-05T18:00:00Z'));

    await expect(amendAgreedAmount(db, record.id, PKR_9000)).rejects.toThrow(
      PaymentImmutabilityError,
    );
  });

  it('leaves the stored figure untouched when an amendment is refused', async () => {
    const record = await newRecord();
    await markPaidByFamily(db, record.id, new Date('2026-08-05T10:00:00Z'));
    await confirmReceivedByTutor(db, record.id, new Date('2026-08-05T18:00:00Z'));

    await expect(amendAgreedAmount(db, record.id, PKR_9000)).rejects.toThrow();

    // The point of the rule: what both parties acknowledged is what is stored.
    const [reloaded] = await db.query.paymentRecords.findMany({
      where: (r, { eq }) => eq(r.id, record.id),
    });
    expect(reloaded!.agreedAmount).toBe(PKR_8000);
  });

  it('is IMMUTABLE while the record is under dispute', async () => {
    const record = await newRecord();
    await raiseDispute(db, {
      paymentRecordId: record.id,
      raisedBy: fixture.parentUserId,
      raisedByParty: 'family',
      reason: 'amount_disagreement',
      detail: 'Agreed 8,000 verbally but the record shows a travel charge we did not agree.',
    });

    // An administrator resolving a disagreement about a figure must be looking
    // at the figure both parties were looking at.
    await expect(amendAgreedAmount(db, record.id, PKR_9000)).rejects.toThrow(
      PaymentImmutabilityError,
    );
  });

  it('rejects a non-integer amount — money is integer paisa', async () => {
    const record = await newRecord();
    await expect(amendAgreedAmount(db, record.id, 8000.5)).rejects.toThrow(PaymentStateError);
  });
});

describe('disputes', () => {
  it('moves the record to disputed and records who raised it', async () => {
    const record = await newRecord();
    const { record: disputed, dispute } = await raiseDispute(db, {
      paymentRecordId: record.id,
      raisedBy: fixture.tutorUserId,
      raisedByParty: 'tutor',
      reason: 'not_received',
    });

    expect(disputed.status).toBe('disputed');
    expect(dispute.status).toBe('open');
    expect(dispute.raisedByParty).toBe('tutor');
  });

  it('counts open disputes per account for the FR-31.9 pattern indicator', async () => {
    const a = await newRecord();
    const b = await createPaymentRecord(db, {
      bookingId: fixture.bookingId,
      cycleLabel: '2026-09',
      agreedAmount: PKR_8000,
      rateType: 'monthly',
      engagementType: 'monthly',
    });

    for (const record of [a, b]) {
      await raiseDispute(db, {
        paymentRecordId: record.id,
        raisedBy: fixture.tutorUserId,
        raisedByParty: 'tutor',
        reason: 'not_received',
      });
    }

    expect(await countOpenDisputesRaisedBy(db, fixture.tutorUserId)).toBe(2);
    expect(await countOpenDisputesRaisedBy(db, fixture.parentUserId)).toBe(0);
  });
});
