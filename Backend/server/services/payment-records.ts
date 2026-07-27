/**
 * Payment records at engagement level — §6.31.
 *
 * ── The boundary, restated because it is the most important thing here ─────
 * **Ustaad.com records what was agreed and what both parties confirm was paid.
 * It does not process payments, hold funds, act as an escrow, or move money in
 * any form.** Settlement is directly between the family and the tutor. There is
 * no gateway in this project and none is stubbed. Every function below is
 * record-keeping (§4.2, CLAUDE.md §2.6).
 *
 * §2.3 is why a record is worth building without one. The informal market's
 * payment failure is not the absence of a gateway — families and tutors
 * transact in cash perfectly well. The failure is that **nothing records what
 * was agreed**, so a disagreement becomes an argument with no evidence on
 * either side, and the party with less standing loses. A dual-acknowledgement
 * record with an administrator dispute path resolves most of that at very low
 * technical cost.
 *
 * `server/services/payments.ts` holds the acknowledgement lifecycle and the
 * FR-31.1 immutability rule. This file holds what surrounds it: creating the
 * record at confirmation, resolving a dispute, deciding who may look, and
 * assembling the per-engagement statement.
 */

import { and, eq, isNull, or } from 'drizzle-orm';

import {
  PaymentStateError,
  describeAcknowledgement,
  type AcknowledgementState,
  type PaymentStatus,
} from '../../shared/payment-status';
import { toDbTimestamp } from '../../shared/db-values';
import { paymentDisputes, paymentRecords } from '../db/schema/payment';
import { tutorProfiles, tutorRates } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';
import { getBookingOrThrow } from '../repositories/bookings';
import {
  getPaymentRecordOrThrow,
  insertPaymentRecord,
  updatePaymentRecord,
  type PaymentRecordEntity,
} from '../repositories/payments';
import { appendAdminAction } from './audit';

/** Restated on every response where payment appears (FR-31.10, SEC-23). */
export const PAYMENT_DISCLAIMER =
  'Ustaad.com records what was agreed and what both parties confirm was paid. It does not ' +
  'process, hold or transfer money. Payment is made directly between the family and the tutor.';

/* =========================================================================
 * Creation at confirmation — FR-31.1, FR-31.2
 * ====================================================================== */

/**
 * The rate that applies, most specific first.
 *
 * A tutor may hold a blanket rate and a narrower one for a subject and level.
 * The narrower wins; a tie is broken by the **lowest** normalised hourly, so a
 * family is never charged more because two rows happened to match.
 */
async function resolveApplicableRate(
  db: Executor,
  booking: { tutorId: string; subjectId: string; levelId: string; mode: string },
): Promise<typeof tutorRates.$inferSelect | null> {
  const candidates = await db
    .select()
    .from(tutorRates)
    .where(
      and(
        eq(tutorRates.tutorId, booking.tutorId),
        eq(tutorRates.mode, booking.mode as 'home'),
        or(eq(tutorRates.subjectId, booking.subjectId), isNull(tutorRates.subjectId))!,
        or(eq(tutorRates.levelId, booking.levelId), isNull(tutorRates.levelId))!,
      ),
    );

  if (candidates.length === 0) return null;

  const specificity = (r: typeof tutorRates.$inferSelect): number =>
    (r.subjectId ? 2 : 0) + (r.levelId ? 1 : 0);

  return [...candidates].sort(
    (a, b) =>
      specificity(b) - specificity(a) || a.normalisedHourlyAmount - b.normalisedHourlyAmount,
  )[0]!;
}

/** `2026-08` for a monthly cycle, `session-1` for a one-off. */
export function cycleLabelFor(engagementType: string, slotStart: string | null): string {
  if (engagementType === 'single_session') return 'session-1';
  const at = slotStart ? new Date(slotStart) : new Date();
  return at.toISOString().slice(0, 7);
}

function toRecordShape(row: typeof paymentRecords.$inferSelect): PaymentRecordEntity {
  return {
    id: row.id,
    bookingId: row.bookingId,
    cycleLabel: row.cycleLabel,
    agreedAmount: row.agreedAmount,
    travelCharge: row.travelCharge,
    rateType: row.rateType,
    engagementType: row.engagementType,
    familyMarkedPaidAt: row.familyMarkedPaidAt ? new Date(row.familyMarkedPaidAt) : null,
    tutorConfirmedAt: row.tutorConfirmedAt ? new Date(row.tutorConfirmedAt) : null,
    status: row.status,
    createdAt: new Date(row.createdAt),
  };
}

export interface ConfirmationRecordResult {
  record: PaymentRecordEntity | null;
  /** Why no record was created, when one was not. */
  skipped: string | null;
}

/**
 * Create the payment record for a booking that has just been confirmed.
 *
 * **The figures are snapshotted at this moment** (FR-31.1). A tutor who edits
 * their pricing next week does not change what this family agreed to — that is
 * the whole point of a record, and capturing the moment is precisely what the
 * informal market fails to do.
 *
 * Idempotent: confirming twice does not produce a second record.
 *
 * Creates nothing, and throws nothing, when there is no fee to record. A
 * volunteer teaches for free (FR-33.10) and a missing rate must never block a
 * confirmed booking from going ahead — the lesson is a lesson either way.
 */
export async function createPaymentRecordOnConfirmation(
  db: Executor,
  bookingId: string,
): Promise<ConfirmationRecordResult> {
  const booking = await getBookingOrThrow(db, bookingId);

  const existing = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.bookingId, bookingId));
  if (existing[0]) {
    return { record: toRecordShape(existing[0]), skipped: 'a record already exists' };
  }

  const tutor = (
    await db
      .select({ volunteerFlag: tutorProfiles.volunteerFlag })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.id, booking.tutorId))
      .limit(1)
  )[0];

  if (tutor?.volunteerFlag === 1) {
    return { record: null, skipped: 'volunteer engagement, no fee' };
  }

  const rate = await resolveApplicableRate(db, {
    tutorId: booking.tutorId,
    subjectId: booking.subjectId,
    levelId: booking.levelId,
    mode: booking.mode,
  });

  if (!rate) return { record: null, skipped: 'no rate matches this engagement' };

  const record = await insertPaymentRecord(db, {
    bookingId,
    cycleLabel: cycleLabelFor(booking.engagementType, booking.slotStart),
    // For a group rate the family pays the per-head figure, not the tutor's total.
    agreedAmount: rate.perHeadAmount ?? rate.amount,
    // A separate recorded line, never folded into the rate (FR-31.2).
    travelCharge: booking.mode === 'online' ? 0 : rate.travelCharge,
    rateType: rate.rateType,
    engagementType: booking.engagementType,
  });

  return { record, skipped: null };
}

/* =========================================================================
 * Dispute resolution — FR-31.6, FR-31.7
 * ====================================================================== */

export interface ResolveDisputeInput {
  disputeId: string;
  adminUserId: string;
  /** What the record should say once resolved. */
  outcome: PaymentStatus;
  /** Written reasoning. Recorded permanently (FR-31.7). */
  reason: string;
}

/**
 * An administrator resolves a dispute.
 *
 * The resolution goes into the **append-only** audit log with actor, timestamp
 * and reasoning (FR-31.7, NFR-19), carrying the engagement context the
 * administrator was looking at (FR-31.6). Neither the dispute row nor the audit
 * entry is ever edited afterwards.
 *
 * Note what the administrator does **not** do: move money. They record what the
 * platform now holds to be true about a cash transaction between two other
 * people. If the parties still disagree after that, the platform's contribution
 * is the evidence, not a judgment it can enforce.
 */
export async function resolveDispute(
  db: Executor,
  input: ResolveDisputeInput,
  now: Date = new Date(),
): Promise<{ record: PaymentRecordEntity; disputeId: string }> {
  if (input.reason.trim().length < 15) {
    throw new PaymentStateError(
      'a written reason of at least 15 characters is required; it is recorded permanently in ' +
        'the audit log and shown to both parties (FR-31.7)',
    );
  }

  const rows = await db
    .select()
    .from(paymentDisputes)
    .where(and(eq(paymentDisputes.id, input.disputeId), eq(paymentDisputes.status, 'open')))
    .limit(1);
  const dispute = rows[0];
  if (!dispute) throw new PaymentStateError('no such open dispute');

  const record = await getPaymentRecordOrThrow(db, dispute.paymentRecordId);

  await db
    .update(paymentDisputes)
    .set({
      status: 'resolved',
      resolvedBy: input.adminUserId,
      resolutionReason: input.reason,
      resolvedAt: toDbTimestamp(now),
    })
    .where(eq(paymentDisputes.id, input.disputeId));

  const updated = await updatePaymentRecord(db, record.id, { status: input.outcome });

  // The engagement record attached (FR-31.6), the reasoning kept (FR-31.7).
  // No CNIC, no address, no token — this log is never deleted from.
  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'payment_dispute.resolved',
    targetType: 'payment_record',
    targetId: record.id,
    detailJson: {
      disputeId: input.disputeId,
      bookingId: record.bookingId,
      cycleLabel: record.cycleLabel,
      agreedAmount: record.agreedAmount,
      travelCharge: record.travelCharge,
      raisedByParty: dispute.raisedByParty,
      disputeReason: dispute.reason,
      outcome: input.outcome,
      resolutionReason: input.reason,
    },
  });

  return { record: updated, disputeId: input.disputeId };
}

/** Open disputes, oldest first. Administrators only. */
export async function listOpenDisputes(db: Executor): Promise<
  { dispute: typeof paymentDisputes.$inferSelect; record: PaymentRecordEntity }[]
> {
  const rows = await db
    .select({ dispute: paymentDisputes, record: paymentRecords })
    .from(paymentDisputes)
    .innerJoin(paymentRecords, eq(paymentRecords.id, paymentDisputes.paymentRecordId))
    .where(eq(paymentDisputes.status, 'open'))
    .orderBy(paymentDisputes.createdAt);

  return rows.map((row) => ({ dispute: row.dispute, record: toRecordShape(row.record) }));
}

/* =========================================================================
 * Visibility — FR-31.11, SEC-22
 * ====================================================================== */

export interface PaymentViewer {
  userId: string;
  role: 'parent' | 'student' | 'tutor' | 'organisation' | 'admin';
}

/**
 * Who may see a payment record: **the two parties, and administrators.**
 *
 * Nobody else, and never a public surface. Resolved from the booking rather
 * than trusted from a parameter, so a caller cannot assert a relationship it
 * does not have.
 */
export async function canViewPaymentRecords(
  db: Executor,
  bookingId: string,
  viewer: PaymentViewer,
): Promise<boolean> {
  if (viewer.role === 'admin') return true;

  const booking = await getBookingOrThrow(db, bookingId).catch(() => null);
  if (!booking) return false;
  if (booking.requestedByUserId === viewer.userId) return true;

  const tutor = (
    await db
      .select({ userId: tutorProfiles.userId })
      .from(tutorProfiles)
      .where(eq(tutorProfiles.id, booking.tutorId))
      .limit(1)
  )[0];

  return tutor?.userId === viewer.userId;
}

/* =========================================================================
 * The per-engagement statement — the trail the informal market lacks
 * ====================================================================== */

export interface EngagementStatementLine {
  recordId: string;
  cycleLabel: string;
  /** Paisa. */
  agreedAmount: number;
  travelCharge: number;
  totalAgreed: number;
  status: PaymentStatus;
  acknowledgement: AcknowledgementState;
  disputes: { id: string; reason: string; status: string; resolutionReason: string | null }[];
  createdAt: Date;
}

export interface EngagementStatement {
  bookingId: string;
  lines: EngagementStatementLine[];
  /** Paisa. What **both** parties have confirmed, and nothing else. */
  totalSettled: number;
  /** Paisa. Agreed but not yet confirmed by both. */
  totalOutstanding: number;
  disclaimer: string;
}

/**
 * Every cycle on one engagement, with its acknowledgements and any dispute.
 *
 * `totalSettled` counts only records both parties have confirmed. A one-sided
 * claim contributes to `totalOutstanding` instead — the statement must not
 * quietly promote an assertion into a fact, which is the failure mode the whole
 * module exists to prevent.
 */
export async function buildEngagementStatement(
  db: Executor,
  bookingId: string,
): Promise<EngagementStatement> {
  const records = await db
    .select()
    .from(paymentRecords)
    .where(eq(paymentRecords.bookingId, bookingId))
    .orderBy(paymentRecords.cycleLabel);

  const lines: EngagementStatementLine[] = [];
  let totalSettled = 0;
  let totalOutstanding = 0;

  for (const row of records) {
    const record = toRecordShape(row);
    const total = record.agreedAmount + record.travelCharge;

    if (record.status === 'settled') totalSettled += total;
    else totalOutstanding += total;

    const disputes = await db
      .select()
      .from(paymentDisputes)
      .where(eq(paymentDisputes.paymentRecordId, record.id));

    lines.push({
      recordId: record.id,
      cycleLabel: record.cycleLabel,
      agreedAmount: record.agreedAmount,
      travelCharge: record.travelCharge,
      totalAgreed: total,
      status: record.status,
      acknowledgement: describeAcknowledgement(record),
      disputes: disputes.map((d) => ({
        id: d.id,
        reason: d.reason,
        status: d.status,
        resolutionReason: d.resolutionReason,
      })),
      createdAt: record.createdAt,
    });
  }

  return { bookingId, lines, totalSettled, totalOutstanding, disclaimer: PAYMENT_DISCLAIMER };
}
