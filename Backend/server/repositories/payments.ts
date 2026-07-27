/**
 * Payment aggregate — records and disputes.
 *
 * **Records payments; never processes them.** No gateway, no escrow, no fund
 * custody, no payout (CLAUDE.md §2.6).
 *
 * The FR-31.1 immutability rule is *not* enforced here — it lives in
 * `server/services/payments.ts`, which is the only caller permitted to write
 * `agreedAmount`. This module is persistence: it maps rows to domain objects
 * and back, and exposes no operation the service does not need.
 */

import { and, eq } from 'drizzle-orm';

import type { DisputeStatus, PaymentParty, PaymentStatus } from '../../shared/payment-status';
import { fromDbTimestamp, newId, nowIso, toDbTimestamp } from '../../shared/db-values';
import type { RateType } from '../../shared/rates';
import { paymentDisputes, paymentRecords } from '../db/schema/payment';
import type { EngagementType } from '../db/schema/booking';
import { type Executor, NotFoundError } from './_base';

export interface PaymentRecordEntity {
  id: string;
  bookingId: string;
  cycleLabel: string;
  /** Paisa. */
  agreedAmount: number;
  /** Paisa. */
  travelCharge: number;
  rateType: RateType;
  engagementType: EngagementType;
  familyMarkedPaidAt: Date | null;
  tutorConfirmedAt: Date | null;
  status: PaymentStatus;
  createdAt: Date;
}

export interface PaymentDisputeEntity {
  id: string;
  paymentRecordId: string;
  raisedBy: string;
  raisedByParty: PaymentParty;
  reason: string;
  detail: string | null;
  status: DisputeStatus;
  resolvedBy: string | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

type StoredRecord = typeof paymentRecords.$inferSelect;
type StoredDispute = typeof paymentDisputes.$inferSelect;

function toRecordDomain(row: StoredRecord): PaymentRecordEntity {
  return {
    id: row.id,
    bookingId: row.bookingId,
    cycleLabel: row.cycleLabel,
    agreedAmount: row.agreedAmount,
    travelCharge: row.travelCharge,
    rateType: row.rateType,
    engagementType: row.engagementType,
    familyMarkedPaidAt: fromDbTimestamp(row.familyMarkedPaidAt),
    tutorConfirmedAt: fromDbTimestamp(row.tutorConfirmedAt),
    status: row.status,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

function toDisputeDomain(row: StoredDispute): PaymentDisputeEntity {
  return {
    id: row.id,
    paymentRecordId: row.paymentRecordId,
    raisedBy: row.raisedBy,
    raisedByParty: row.raisedByParty,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolutionReason: row.resolutionReason,
    resolvedAt: fromDbTimestamp(row.resolvedAt),
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function insertPaymentRecord(
  db: Executor,
  input: {
    bookingId: string;
    cycleLabel: string;
    agreedAmount: number;
    travelCharge?: number;
    rateType: RateType;
    engagementType: EngagementType;
  },
): Promise<PaymentRecordEntity> {
  const id = newId();
  await db.insert(paymentRecords).values({
    id,
    bookingId: input.bookingId,
    cycleLabel: input.cycleLabel,
    agreedAmount: input.agreedAmount,
    travelCharge: input.travelCharge ?? 0,
    rateType: input.rateType,
    engagementType: input.engagementType,
    status: 'pending',
    createdAt: nowIso(),
  });
  return getPaymentRecordOrThrow(db, id);
}

export async function findPaymentRecord(
  db: Executor,
  id: string,
): Promise<PaymentRecordEntity | null> {
  const rows = await db.select().from(paymentRecords).where(eq(paymentRecords.id, id)).limit(1);
  return rows[0] ? toRecordDomain(rows[0]) : null;
}

export async function getPaymentRecordOrThrow(
  db: Executor,
  id: string,
): Promise<PaymentRecordEntity> {
  const found = await findPaymentRecord(db, id);
  if (!found) throw new NotFoundError('payment record', id);
  return found;
}

export async function listPaymentRecordsForBooking(
  db: Executor,
  bookingId: string,
): Promise<PaymentRecordEntity[]> {
  const rows = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.bookingId, bookingId));
  return rows.map(toRecordDomain);
}

/**
 * Write a validated patch.
 *
 * `agreedAmount` is accepted here, but the only caller that may set it is
 * `server/services/payments.ts#amendAgreedAmount`, which checks the FR-31.1
 * lock first.
 */
export interface PaymentRecordPatch {
  agreedAmount?: number;
  familyMarkedPaidAt?: Date;
  tutorConfirmedAt?: Date;
  status?: PaymentStatus;
}

export async function updatePaymentRecord(
  db: Executor,
  id: string,
  patch: PaymentRecordPatch,
): Promise<PaymentRecordEntity> {
  const values: Record<string, unknown> = {};
  if (patch.agreedAmount !== undefined) values.agreedAmount = patch.agreedAmount;
  if (patch.familyMarkedPaidAt !== undefined) {
    values.familyMarkedPaidAt = toDbTimestamp(patch.familyMarkedPaidAt);
  }
  if (patch.tutorConfirmedAt !== undefined) {
    values.tutorConfirmedAt = toDbTimestamp(patch.tutorConfirmedAt);
  }
  if (patch.status !== undefined) values.status = patch.status;

  await db.update(paymentRecords).set(values).where(eq(paymentRecords.id, id));
  return getPaymentRecordOrThrow(db, id);
}

export async function deletePaymentRecord(db: Executor, id: string): Promise<void> {
  await db.delete(paymentRecords).where(eq(paymentRecords.id, id));
}

/* -------------------------------------------------------------------------
 * Disputes
 * ---------------------------------------------------------------------- */

export async function insertDispute(
  db: Executor,
  input: {
    paymentRecordId: string;
    raisedBy: string;
    raisedByParty: PaymentParty;
    reason: string;
    detail?: string | null;
  },
): Promise<PaymentDisputeEntity> {
  const id = newId();
  await db.insert(paymentDisputes).values({
    id,
    paymentRecordId: input.paymentRecordId,
    raisedBy: input.raisedBy,
    raisedByParty: input.raisedByParty,
    reason: input.reason,
    detail: input.detail ?? null,
    status: 'open',
    createdAt: nowIso(),
  });

  const rows = await db.select().from(paymentDisputes).where(eq(paymentDisputes.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('payment dispute', id);
  return toDisputeDomain(row);
}

export async function listDisputesForRecord(
  db: Executor,
  paymentRecordId: string,
): Promise<PaymentDisputeEntity[]> {
  const rows = await db
    .select()
    .from(paymentDisputes)
    .where(eq(paymentDisputes.paymentRecordId, paymentRecordId));
  return rows.map(toDisputeDomain);
}

/** FR-31.9: repeated unresolved disputes against a single account. */
export async function countOpenDisputesBy(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .select({ id: paymentDisputes.id })
    .from(paymentDisputes)
    .where(and(eq(paymentDisputes.raisedBy, userId), eq(paymentDisputes.status, 'open')));
  return rows.length;
}

export async function deleteDispute(db: Executor, id: string): Promise<void> {
  await db.delete(paymentDisputes).where(eq(paymentDisputes.id, id));
}
