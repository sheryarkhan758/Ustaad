import { describe, expect, it } from 'vitest';

import {
  BOOKING_STATUSES,
  BookingTransitionError,
  TERMINAL_BOOKING_STATUSES,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  countsTowardConfirmationRate,
  isSafetyConstrainedDecline,
  isTerminal,
} from './booking-status';

describe('the happy path', () => {
  it('runs requested → confirmed → in_progress → completed', () => {
    expect(canTransition('requested', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });

  it('permits no move at all out of completed', () => {
    // A completed booking is what reviews, payment records and the progress
    // ledger hang off. Reopening it would silently invalidate all three.
    expect(allowedTransitionsFrom('completed')).toEqual([]);
    expect(isTerminal('completed')).toBe(true);
  });
});

describe('illegal moves are refused', () => {
  it('cannot skip straight from requested to completed', () => {
    expect(canTransition('requested', 'completed')).toBe(false);
    expect(() => assertTransition('requested', 'completed')).toThrow(BookingTransitionError);
  });

  it('cannot decline a booking that was already confirmed', () => {
    // Declining is a response to a request; withdrawing later is a cancellation.
    expect(canTransition('confirmed', 'declined')).toBe(false);
  });

  it('cannot reopen a cancelled or declined booking', () => {
    for (const status of ['cancelled', 'declined', 'no_show'] as const) {
      expect(allowedTransitionsFrom(status)).toEqual([]);
      expect(() => assertTransition(status, 'confirmed')).toThrow(/terminal/);
    }
  });

  it('rejects a no-op transition rather than silently accepting it', () => {
    expect(() => assertTransition('confirmed', 'confirmed')).toThrow(/already/);
  });

  it('names the permitted moves in the error, so the caller can act on it', () => {
    expect(() => assertTransition('requested', 'in_progress')).toThrow(
      /allowed: confirmed, declined, cancelled/,
    );
  });
});

describe('the state table is complete', () => {
  it('defines transitions for every declared status', () => {
    for (const status of BOOKING_STATUSES) {
      expect(Array.isArray(allowedTransitionsFrom(status))).toBe(true);
    }
  });

  it('has exactly four terminal states', () => {
    expect([...TERMINAL_BOOKING_STATUSES].sort()).toEqual([
      'cancelled',
      'completed',
      'declined',
      'no_show',
    ]);
  });
});

describe('safety-constrained declines — SEC-21, FR-29.14', () => {
  it('identifies a decline made under a declared safety constraint', () => {
    expect(isSafetyConstrainedDecline('declined', true)).toBe(true);
    expect(isSafetyConstrainedDecline('declined', false)).toBe(false);
    // The flag is meaningless on any other status.
    expect(isSafetyConstrainedDecline('cancelled', true)).toBe(false);
  });

  it('EXCLUDES such declines from the confirmation-rate denominator', () => {
    // The reason this matters: the platform's primary use case sends a woman
    // alone to an address she has not seen. If declining on her own declared
    // terms lowered her public confirmation rate, the statistic would become a
    // pressure to accept engagements she judged unsafe.
    expect(
      countsTowardConfirmationRate({ status: 'declined', declineUnderSafetyConstraint: true }),
    ).toBe(false);
  });

  it('still counts an ordinary decline', () => {
    expect(
      countsTowardConfirmationRate({ status: 'declined', declineUnderSafetyConstraint: false }),
    ).toBe(true);
  });

  it('counts confirmed and completed bookings, and ignores pending requests', () => {
    expect(
      countsTowardConfirmationRate({ status: 'confirmed', declineUnderSafetyConstraint: false }),
    ).toBe(true);
    expect(
      countsTowardConfirmationRate({ status: 'completed', declineUnderSafetyConstraint: false }),
    ).toBe(true);
    // A request the tutor has not answered yet is not evidence either way.
    expect(
      countsTowardConfirmationRate({ status: 'requested', declineUnderSafetyConstraint: false }),
    ).toBe(false);
  });
});
