/**
 * Payment record service — §6.31.
 *
 * **This module records payments.  It does not process them.**  There is no
 * gateway client here, no escrow, no fund custody, no payout, no commission and
 * no refund.  Money moves in cash, directly between a family and a tutor; what
 * this module maintains is the two-sided written record the informal market
 * lacks (CLAUDE.md §2.6).
 *
 * The one rule that needs a service layer rather than a column type:
 * **`agreedAmount` is immutable once both parties have acknowledged the
 * record** (FR-31.1).  A database cannot express "immutable after a state
 * transition" portably, so it is enforced here, and this module is the only
 * caller permitted to write that column.
 *
 * Persistence lives in `server/repositories/payments.ts`; this file holds the
 * rules.
 */

import {
  PaymentStateError,
  assertAgreedAmountMutable,
  deriveStatus,
  isAgreedAmountLocked,
  isMutuallyAcknowledged,
} from '../../shared/payment-status';
import type { PaymentParty } from '../../shared/payment-status';
import type { RateType } from '../../shared/rates';
import type { EngagementType } from '../db/schema/booking';
import type { Executor } from '../repositories/_base';
import {
  countOpenDisputesBy,
  getPaymentRecordOrThrow,
  insertDispute,
  insertPaymentRecord,
  updatePaymentRecord,
} from '../repositories/payments';
import type { PaymentDisputeEntity, PaymentRecordEntity } from '../repositories/payments';

function assertIntegerPaisa(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new PaymentStateError(
      `${field} must be a non-negative integer count of paisa, received ${value}`,
    );
  }
}

export interface CreatePaymentRecordInput {
  bookingId: string;
  cycleLabel: string;
  /** Paisa. */
  agreedAmount: number;
  /** Paisa. */
  travelCharge?: number;
  rateType: RateType;
  engagementType: EngagementType;
}

export async function createPaymentRecord(
  db: Executor,
  input: CreatePaymentRecordInput,
): Promise<PaymentRecordEntity> {
  assertIntegerPaisa(input.agreedAmount, 'agreedAmount');
  if (input.travelCharge !== undefined) assertIntegerPaisa(input.travelCharge, 'travelCharge');

  return insertPaymentRecord(db, input);
}

/**
 * Amend the agreed amount.
 *
 * Permitted only while the record is still one-sided or untouched.  Once both
 * parties have acknowledged — or the record is under dispute — the figure is
 * evidence and this throws (FR-31.1).
 *
 * @throws {PaymentImmutabilityError}
 */
export async function amendAgreedAmount(
  db: Executor,
  recordId: string,
  newAgreedAmount: number,
): Promise<PaymentRecordEntity> {
  const record = await getPaymentRecordOrThrow(db, recordId);
  assertAgreedAmountMutable(record);
  assertIntegerPaisa(newAgreedAmount, 'agreedAmount');

  return updatePaymentRecord(db, recordId, { agreedAmount: newAgreedAmount });
}

/** The family states it has paid.  One-sided — displays as unconfirmed (FR-31.4). */
export async function markPaidByFamily(
  db: Executor,
  recordId: string,
  at: Date,
): Promise<PaymentRecordEntity> {
  const record = await getPaymentRecordOrThrow(db, recordId);
  if (record.familyMarkedPaidAt !== null) {
    throw new PaymentStateError('the family has already marked this record as paid');
  }

  const next = { ...record, familyMarkedPaidAt: at };
  return updatePaymentRecord(db, recordId, {
    familyMarkedPaidAt: at,
    status: deriveStatus(next),
  });
}

/**
 * The tutor confirms receipt.  Both acknowledgements present ⇒ `settled`, and
 * `agreedAmount` becomes immutable from this moment (FR-31.1, FR-31.4).
 */
export async function confirmReceivedByTutor(
  db: Executor,
  recordId: string,
  at: Date,
): Promise<PaymentRecordEntity> {
  const record = await getPaymentRecordOrThrow(db, recordId);
  if (record.tutorConfirmedAt !== null) {
    throw new PaymentStateError('the tutor has already confirmed this record');
  }

  const next = { ...record, tutorConfirmedAt: at };
  return updatePaymentRecord(db, recordId, {
    tutorConfirmedAt: at,
    status: deriveStatus(next),
  });
}

export interface RaiseDisputeInput {
  paymentRecordId: string;
  raisedBy: string;
  raisedByParty: PaymentParty;
  reason: string;
  detail?: string;
}

/**
 * Either party may dispute a record (FR-31.5).
 *
 * The record moves to `disputed`, which also locks `agreedAmount` if it was not
 * already locked: an administrator resolving a disagreement about a figure must
 * be looking at the figure both parties saw.
 */
export async function raiseDispute(
  db: Executor,
  input: RaiseDisputeInput,
): Promise<{ record: PaymentRecordEntity; dispute: PaymentDisputeEntity }> {
  const record = await getPaymentRecordOrThrow(db, input.paymentRecordId);

  const dispute = await insertDispute(db, {
    paymentRecordId: record.id,
    raisedBy: input.raisedBy,
    raisedByParty: input.raisedByParty,
    reason: input.reason,
    detail: input.detail,
  });

  const updated = await updatePaymentRecord(db, record.id, { status: 'disputed' });
  return { record: updated, dispute };
}

/**
 * Repeated unresolved disputes against one account, surfaced to the
 * administrator as a pattern indicator (FR-31.9).
 */
export async function countOpenDisputesRaisedBy(db: Executor, userId: string): Promise<number> {
  return countOpenDisputesBy(db, userId);
}

export { isAgreedAmountLocked, isMutuallyAcknowledged };
export type { PaymentRecordEntity, PaymentDisputeEntity };
