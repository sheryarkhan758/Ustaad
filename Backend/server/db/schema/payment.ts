/**
 * Payment transparency — specification §9.6, §6.31.
 *
 * The boundary comes before the schema, because the boundary is the most
 * important thing about this module:
 *
 *   **Ustaad.com records what was agreed and what both parties confirm was
 *   paid. It does not process payments, hold funds, act as an escrow, or move
 *   money in any form.** Settlement is directly between the family and the
 *   tutor. There is no gateway, no wallet, no balance, no payout, no
 *   commission, and no refund flow here or anywhere else in this codebase
 *   (§4.2, CLAUDE.md §2.6).
 *
 * What these two tables buy is the thing the informal market lacks: a written,
 * two-sided, timestamped record, so that a disagreement is settled by evidence
 * rather than by whoever argues more forcefully.
 *
 * Visibility: the two parties to the engagement, and administrators. Nobody
 * else, ever — not search, not a public profile, not a ranking input
 * (FR-31.11, FR-31.12, SEC-22).
 */

import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { createdAt, paisa, pk, timestampCol } from './_common';

import { DISPUTE_STATUSES, PAYMENT_PARTIES, PAYMENT_STATUSES } from '../../../shared/payment-status';
import { RATE_TYPES } from '../../../shared/rates';
import { ENGAGEMENT_TYPES, bookings } from './booking';
import { users } from './identity';

export const paymentRecords = sqliteTable(
  'payment_records',
  {
    id: pk(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /**
     * Which cycle this record covers — `"2026-08"` for a monthly engagement,
     * `"session-1"` for a single session. Text rather than a date, because a
     * cycle is a label the two parties agree on, not a computed interval.
     */
    cycleLabel: text('cycle_label').notNull(),

    /**
     * Paisa. **Immutable once acknowledged by both parties** (FR-31.1).
     *
     * Enforced by `server/services/payments.ts`, which is the only module
     * permitted to write this column. A correction after the fact goes through
     * a dispute and an administrator resolution, so it leaves an audit trail
     * (FR-31.7) rather than silently replacing the figure both parties saw.
     */
    agreedAmount: paisa('agreed_amount').notNull(),
    /** Paisa. Recorded as a separate line (FR-31.2). */
    travelCharge: paisa('travel_charge').notNull().default(0),

    /** Copied from the booking at creation, so the record stands alone. */
    rateType: text('rate_type', { enum: RATE_TYPES }).notNull(),
    engagementType: text('engagement_type', { enum: ENGAGEMENT_TYPES }).notNull(),

    /** The family says it paid. One-sided — displays as unconfirmed. */
    familyMarkedPaidAt: timestampCol('family_marked_paid_at'),
    /** The tutor confirms receipt. Both present ⇒ settled (FR-31.4). */
    tutorConfirmedAt: timestampCol('tutor_confirmed_at'),

    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_payment_records_booking').on(t.bookingId),
    // Administrator dispute queue and the pattern indicator in FR-31.9.
    index('idx_payment_records_status').on(t.status, t.createdAt),
  ],
);

/**
 * A disagreement about a payment record — FR-31.5 to FR-31.7.
 *
 * Either party may raise one. It routes to the administrator queue with the
 * full engagement record attached, and the resolution is written with actor,
 * timestamp and reasoning into the append-only audit log (FR-31.7).
 */
export const paymentDisputes = sqliteTable(
  'payment_disputes',
  {
    id: pk(),
    paymentRecordId: text('payment_record_id')
      .notNull()
      .references(() => paymentRecords.id, { onDelete: 'cascade' }),
    raisedBy: text('raised_by')
      .notNull()
      .references(() => users.id),
    /** Which side raised it — needed for FR-31.9 pattern detection. */
    raisedByParty: text('raised_by_party', { enum: PAYMENT_PARTIES }).notNull(),
    /** Short reason code chosen by the raiser. */
    reason: text('reason').notNull(),
    /** Free text, any script. Stored unchanged, never translated (§2.10). */
    detail: text('detail'),
    status: text('status', { enum: DISPUTE_STATUSES }).notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => users.id),
    resolutionReason: text('resolution_reason'),
    resolvedAt: timestampCol('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_payment_disputes_record').on(t.paymentRecordId),
    // The administrator queue: open disputes, oldest first.
    index('idx_payment_disputes_status').on(t.status, t.createdAt),
    // FR-31.9: repeated unresolved disputes against one account.
    index('idx_payment_disputes_raiser').on(t.raisedBy, t.status),
  ],
);

export type PaymentRecord = typeof paymentRecords.$inferSelect;
export type NewPaymentRecord = typeof paymentRecords.$inferInsert;
export type PaymentDispute = typeof paymentDisputes.$inferSelect;
