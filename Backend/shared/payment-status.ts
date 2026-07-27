/**
 * Payment record status and the immutability rule — §6.31, FR-31.1, FR-31.4.
 *
 * **The platform records payments; it never processes them.**  Nothing in this
 * file or anywhere downstream moves money, holds funds, or talks to a gateway.
 * A payment record is a mutually acknowledged statement about a transaction
 * that happened in cash, directly between a family and a tutor
 * (CLAUDE.md §2.6).
 *
 * The rules that matter:
 *
 *  · A payment is `settled` only when **both** parties have acknowledged it.
 *    A single-party claim is `family_marked` and displays as unconfirmed
 *    (FR-31.4) — the whole value of the record is that it is two-sided.
 *  · `agreed_amount` becomes **immutable** once the record is confirmed by both
 *    parties (FR-31.1).  Enforced in the service layer, not in the UI.
 *
 * The predicates live here, pure, so they can be reasoned about and tested
 * without a database, and so the client can grey out a field the server will
 * refuse anyway.
 */

export const PAYMENT_STATUSES = ['pending', 'family_marked', 'settled', 'disputed'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PARTIES = ['family', 'tutor', 'admin'] as const;
export type PaymentParty = (typeof PAYMENT_PARTIES)[number];

export const DISPUTE_STATUSES = ['open', 'under_review', 'resolved', 'withdrawn'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export class PaymentImmutabilityError extends Error {
  /**
   * 409 Conflict.
   *
   * The request is well formed; it is the record's state that makes it
   * impossible. 400 would suggest the caller could fix the body and retry, and
   * they cannot — the figure is evidence now.
   */
  readonly status = 409;
  readonly code = 'agreed_amount_immutable';

  constructor(message: string) {
    super(message);
    this.name = 'PaymentImmutabilityError';
  }
}

export class PaymentStateError extends Error {
  readonly status = 409;
  readonly code = 'payment_state';

  constructor(message: string) {
    super(message);
    this.name = 'PaymentStateError';
  }
}

export interface PaymentAcknowledgement {
  status: PaymentStatus;
  familyMarkedPaidAt: Date | null;
  tutorConfirmedAt: Date | null;
}

/**
 * Both parties have acknowledged, so the record is settled (FR-31.4).
 *
 * Derived from the two timestamps rather than trusted from `status`, because
 * the timestamps are the evidence and `status` is a summary of them.
 */
export function isMutuallyAcknowledged(record: PaymentAcknowledgement): boolean {
  return record.familyMarkedPaidAt !== null && record.tutorConfirmedAt !== null;
}

/**
 * `agreed_amount` may no longer change (FR-31.1).
 *
 * Locked once both parties have acknowledged — that is the moment the record
 * becomes evidence. Also locked while disputed: an administrator resolving a
 * disagreement about an amount must be looking at the amount both parties were
 * looking at, not one that moved underneath them.
 */
export function isAgreedAmountLocked(record: PaymentAcknowledgement): boolean {
  return isMutuallyAcknowledged(record) || record.status === 'settled' || record.status === 'disputed';
}

/** @throws {PaymentImmutabilityError} when the amount is frozen. */
export function assertAgreedAmountMutable(record: PaymentAcknowledgement): void {
  if (isAgreedAmountLocked(record)) {
    throw new PaymentImmutabilityError(
      'The agreed amount on this payment record is immutable: it has been ' +
        `acknowledged by both parties or is under dispute (status "${record.status}"). ` +
        'Correct it by raising a dispute and recording an administrator resolution, ' +
        'which leaves an audit trail, rather than by editing the figure (FR-31.1, FR-31.7).',
    );
  }
}

/**
 * The status a record should hold given its acknowledgements.
 *
 * `disputed` is sticky: a dispute is cleared by resolving it, never by one
 * party acknowledging again.
 */
export function deriveStatus(record: PaymentAcknowledgement): PaymentStatus {
  if (record.status === 'disputed') return 'disputed';
  if (isMutuallyAcknowledged(record)) return 'settled';
  // `family_marked` means what it says: the family marked it. A tutor who has
  // confirmed receipt while the family has not yet acknowledged leaves the
  // record `pending` — with `tutorConfirmedAt` populated, so the interface can
  // say precisely who has acknowledged. Labelling that state `family_marked`
  // would put a claim in the family's mouth that they did not make, and the
  // whole value of this record is that each side speaks only for itself.
  if (record.familyMarkedPaidAt !== null) return 'family_marked';
  return 'pending';
}

/** Who has acknowledged. Both single-sided cases display as unconfirmed (FR-31.4). */
export interface AcknowledgementState {
  familyHasMarkedPaid: boolean;
  tutorHasConfirmed: boolean;
  settled: boolean;
  /** Shown wherever the record appears, so a one-sided claim reads as one. */
  summary: string;
}

export function describeAcknowledgement(record: PaymentAcknowledgement): AcknowledgementState {
  const family = record.familyMarkedPaidAt !== null;
  const tutor = record.tutorConfirmedAt !== null;

  const summary = record.status === 'disputed'
    ? 'Disputed. An administrator is reviewing this record.'
    : family && tutor
      ? 'Confirmed by both parties.'
      : family
        ? "Marked paid by the family — awaiting the tutor's confirmation."
        : tutor
          ? "Confirmed received by the tutor — awaiting the family's acknowledgement."
          : 'Payment pending. Neither party has acknowledged it yet.';

  return { familyHasMarkedPaid: family, tutorHasConfirmed: tutor, settled: family && tutor, summary };
}

/**
 * Payment history contributes to neither public ranking nor public statistics
 * (FR-31.12, SEC-22).
 *
 * Present as an exported constant so that any future ranking or benchmark code
 * that reaches for payment data has to delete this line first, deliberately,
 * rather than drift into it.  Allowing acknowledgement history to affect
 * ranking would give tutors a reason to pressure families over confirmations,
 * corrupting the record the module exists to protect.
 */
export const PAYMENT_DATA_IS_NEVER_A_RANKING_INPUT = true as const;
