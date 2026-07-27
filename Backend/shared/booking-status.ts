/**
 * The booking state machine — FR-8.4, FR-8.8.
 *
 * Transitions are enforced here, in code, and called by the service layer on
 * every status write.  The client may use the same table to decide which
 * buttons to render, but that is a convenience: a UI that hides a button is not
 * an enforcement mechanism, and NFR-6 says client-side guards are never relied
 * upon.  Every mutation revalidates server-side.
 *
 * Why a table rather than a chain of `if`s: the permitted set is small, finite,
 * and worth reading at a glance, and an exhaustive table makes "can this
 * booking be cancelled?" a lookup rather than an argument.
 */

/**
 * `requested` → `confirmed` → `in_progress` → `completed` is the happy path.
 * `declined` is reachable only from `requested` (a tutor declining a request).
 * `no_show` is reachable once a booking is live, and is recorded against the
 * responsible party (FR-8.8).
 */
export const BOOKING_STATUSES = [
  'requested',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'declined',
  'no_show',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Who moved the booking.  Recorded alongside the transition (FR-8.8). */
export const BOOKING_ACTORS = ['tutor', 'requester', 'admin', 'system'] as const;
export type BookingActor = (typeof BOOKING_ACTORS)[number];

const TRANSITIONS: Readonly<Record<BookingStatus, ReadonlyArray<BookingStatus>>> = {
  requested: ['confirmed', 'declined', 'cancelled'],
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled', 'no_show'],
  // Terminal. A completed booking is the thing reviews, payment records and the
  // progress ledger all hang off; reopening it would silently invalidate them.
  completed: [],
  cancelled: [],
  declined: [],
  no_show: [],
};

export const TERMINAL_BOOKING_STATUSES = BOOKING_STATUSES.filter(
  (status) => TRANSITIONS[status].length === 0,
);

export class BookingTransitionError extends Error {
  readonly from: BookingStatus;
  readonly to: BookingStatus;
  /**
   * 409 Conflict, not 400.
   *
   * The request was well formed; it is the booking's current state that makes
   * it impossible. A caller retrying the identical request after the booking
   * moves on may well succeed, which is exactly what 409 means and 400 does not.
   */
  readonly status = 409;
  readonly code = 'illegal_transition';

  constructor(from: BookingStatus, to: BookingStatus, detail: string) {
    super(detail);
    this.name = 'BookingTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitionsFrom(from: BookingStatus): ReadonlyArray<BookingStatus> {
  return TRANSITIONS[from];
}

export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** @throws {BookingTransitionError} when the move is not permitted. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) {
    throw new BookingTransitionError(from, to, `booking is already "${from}"`);
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new BookingTransitionError(
      from,
      to,
      allowed.length === 0
        ? `"${from}" is terminal; a booking cannot move to "${to}"`
        : `cannot move a booking from "${from}" to "${to}" — allowed: ${allowed.join(', ')}`,
    );
  }
}

/**
 * A decline made under a declared safety constraint (SEC-19–21, FR-29.14).
 *
 * These are excluded from a tutor's confirmation-rate statistic, so the flag
 * must be set at the moment of the decline and cannot be reconstructed later.
 * A woman who declines a booking because the address falls in an area she has
 * restricted, or because guardian presence was refused, must not be penalised
 * in a public number for holding to her own conditions.
 */
export function isSafetyConstrainedDecline(
  status: BookingStatus,
  declineUnderSafetyConstraint: boolean,
): boolean {
  return status === 'declined' && declineUnderSafetyConstraint;
}

/**
 * The denominator for confirmation rate: requests the tutor actually chose on,
 * with safety-constrained declines removed (SEC-21).
 *
 * Pure, so `server/services/` can compute the materialised statistic
 * (CLAUDE.md §2.8) and a test can assert the exclusion without a database.
 */
export function countsTowardConfirmationRate(booking: {
  status: BookingStatus;
  declineUnderSafetyConstraint: boolean;
}): boolean {
  if (booking.status === 'requested') return false;
  return !isSafetyConstrainedDecline(booking.status, booking.declineUnderSafetyConstraint);
}
