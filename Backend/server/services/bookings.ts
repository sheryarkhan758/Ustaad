/**
 * Booking lifecycle service — §6.8, FR-8.4, FR-8.8.
 *
 * Every status change goes through `transitionBooking`.  The permitted moves
 * live in `shared/booking-status.ts`; this module validates against them and
 * hands a checked patch to the repository.
 *
 * Transitions are enforced here rather than in the UI (NFR-6).  A client that
 * hides the "cancel" button is a convenience; a server that refuses an
 * impossible move is the guarantee.
 */

import {
  type BookingActor,
  type BookingStatus,
  BookingTransitionError,
  assertTransition,
} from '../../shared/booking-status';
import type { Executor } from '../repositories/_base';
import { applyBookingStatus, getBookingOrThrow } from '../repositories/bookings';
import { releaseSlot } from './booking-create';
import { createPaymentRecordOnConfirmation } from './payment-records';
import type { BookingRecord, BookingStatusPatch } from '../repositories/bookings';

export interface TransitionInput {
  bookingId: string;
  to: BookingStatus;
  by: BookingActor;
  at: Date;
  /** Required when moving to `cancelled` or `declined`. */
  reason?: string;
  /**
   * Set when a tutor declines because of a declared safety constraint
   * (SEC-19–21, FR-29.14).  It must be supplied at the moment of the decline —
   * the reliability job excludes these from the confirmation-rate denominator,
   * and the fact cannot be reconstructed afterwards.
   */
  declineUnderSafetyConstraint?: boolean;
}

export async function transitionBooking(
  db: Executor,
  input: TransitionInput,
): Promise<BookingRecord> {
  const booking = await getBookingOrThrow(db, input.bookingId);

  assertTransition(booking.status, input.to);

  if (input.to === 'declined' && input.by !== 'tutor' && input.by !== 'admin') {
    throw new BookingTransitionError(
      booking.status,
      input.to,
      'only the tutor or an administrator may decline a booking request',
    );
  }
  if (input.declineUnderSafetyConstraint && input.to !== 'declined') {
    throw new BookingTransitionError(
      booking.status,
      input.to,
      'declineUnderSafetyConstraint applies only to a decline (SEC-21)',
    );
  }

  const patch: BookingStatusPatch = {
    status: input.to,
    statusChangedBy: input.by,
    statusChangedAt: input.at,
  };

  // First tutor response, confirm or decline — feeds median response time (FR-17.1).
  if ((input.to === 'confirmed' || input.to === 'declined') && booking.respondedAt === null) {
    patch.respondedAt = input.at;
  }
  if (input.to === 'confirmed') patch.confirmedAt = input.at;
  if (input.to === 'completed') patch.completedAt = input.at;
  if (input.to === 'cancelled') {
    patch.cancelledAt = input.at;
    patch.cancelReason = input.reason ?? null;
  }
  if (input.to === 'declined') {
    patch.cancelReason = input.reason ?? null;
    patch.declineUnderSafetyConstraint = input.declineUnderSafetyConstraint ?? false;
  }

  const updated = await applyBookingStatus(db, input.bookingId, patch);

  // FR-31.1: the agreed rate is snapshotted at confirmation, so a later pricing
  // edit cannot change what this family agreed to. Failure here must not undo a
  // confirmation the tutor has already made — the lesson is arranged either way,
  // and the record can be created again from the booking.
  if (input.to === 'confirmed') {
    try {
      await createPaymentRecordOnConfirmation(db, input.bookingId);
    } catch (error) {
      console.error(
        `[payments] could not create a record for booking ${input.bookingId}: ` +
          (error instanceof Error ? error.message : 'unknown'),
      );
    }
  }

  // A slot held by a booking that will never happen is a slot nobody can book.
  // `completed` keeps its reservation so the history stays truthful about when
  // the tutor was occupied.
  if (input.to === 'cancelled' || input.to === 'declined' || input.to === 'no_show') {
    await releaseSlot(db, input.bookingId);
  }

  return updated;
}
