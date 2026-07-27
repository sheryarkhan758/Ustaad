/**
 * Residential address disclosure — SEC-3, SEC-20, FR-2.8, NFR-18.
 *
 * **This is the only module in the codebase that may decrypt an address.**
 * Route handlers, repositories and templates receive an already-resolved
 * disclosure object; none of them can reach the plaintext by accident, because
 * none of them holds a decrypt function.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * A public profile exposes **area only**. A street address is captured on a
 * booking, stored encrypted, and disclosed to exactly two people:
 *
 *  · **the family who wrote it** — always, from the moment they write it;
 *  · **the tutor** — only once the booking is `confirmed` or later.
 *
 * That asymmetry is SEC-20 and it is the whole point. The platform's primary
 * use case sends a woman alone to an address she has not seen. She is shown the
 * *area* before she decides, so that she can decline on the basis of where it
 * is; the exact address follows her acceptance, not the other way round. A
 * tutor who has not confirmed — or who declined — never learns where the
 * student lives.
 *
 * An administrator is **not** a third party here. They have a separate,
 * explicitly-named function that writes an audit entry first, because "the
 * administrator can see everything" is how an access rule quietly stops being
 * one.
 */

import { encrypt, decrypt } from './crypto';
import { appendAdminAction } from './audit';
import type { BookingStatus } from '../../shared/booking-status';
import type { Executor } from '../repositories/_base';
import { findBookingAddressCiphertext, getBookingOrThrow } from '../repositories/bookings';

/** Statuses at which the tutor has committed to attending. */
const TUTOR_MAY_SEE_ADDRESS: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'confirmed',
  'in_progress',
  'completed',
]);

export class AddressAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressAccessError';
  }
}

/**
 * What a viewer is allowed to see.
 *
 * A discriminated union rather than an optional field, so a caller cannot
 * render `disclosure.address` without having handled the `area_only` case.
 */
export type AddressDisclosure =
  | {
      visibility: 'area_only';
      areaId: string | null;
      address: null;
      /** Shown in the interface so the withholding is explained, not silent. */
      reason: string;
    }
  | {
      visibility: 'full';
      areaId: string | null;
      address: string;
      reason: null;
    };

export interface AddressViewer {
  userId: string;
  role: 'parent' | 'student' | 'tutor' | 'organisation' | 'admin';
}

/** Encrypt an address for storage. The only way one enters the database. */
export function sealAddress(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed === '') throw new AddressAccessError('an address cannot be empty');
  return encrypt(trimmed);
}

/**
 * Resolve what this viewer may see of this booking's address.
 *
 * Loads the booking itself rather than accepting one, so that a caller cannot
 * pass a booking whose status or parties it has adjusted.
 */
export async function discloseAddress(
  db: Executor,
  bookingId: string,
  viewer: AddressViewer,
  /** The tutor's own `users.id`, resolved by the caller from `tutorProfiles`. */
  tutorUserId: string,
): Promise<AddressDisclosure> {
  const booking = await getBookingOrThrow(db, bookingId);
  const ciphertext = await findBookingAddressCiphertext(db, bookingId);

  const areaOnly = (reason: string): AddressDisclosure => ({
    visibility: 'area_only',
    areaId: booking.areaId,
    address: null,
    reason,
  });

  if (!ciphertext) {
    return areaOnly('No address has been recorded for this booking yet.');
  }

  const isRequester = viewer.userId === booking.requestedByUserId;
  const isTutor = viewer.userId === tutorUserId;

  // Anyone who is not a party to this booking. Administrators included — they
  // have their own audited path below.
  if (!isRequester && !isTutor) {
    return areaOnly('Addresses are visible only to the two parties to a confirmed booking.');
  }

  // SEC-20: the tutor sees the locality before deciding, the address after.
  if (isTutor && !TUTOR_MAY_SEE_ADDRESS.has(booking.status)) {
    return areaOnly(
      'The exact address is shared once you confirm this booking. Until then you can see ' +
        'the area, so that you can decide whether to accept.',
    );
  }

  return {
    visibility: 'full',
    areaId: booking.areaId,
    address: decrypt(ciphertext),
    reason: null,
  };
}

/**
 * Administrator disclosure — audited, and separate on purpose.
 *
 * There are real reasons an administrator needs an address: a safety concern
 * raised against a booking, a payment dispute about sessions that did or did
 * not happen. There is no good reason for it to be a side effect of loading a
 * page, so it is a distinct call that demands a written reason and writes to
 * the append-only log **before** decrypting (SEC-13, NFR-19).
 *
 * The audit entry records the booking id and the reason. It does not record the
 * address — the log is never deleted from, so a plaintext address written there
 * would be permanent (CLAUDE.md §2.2).
 */
export async function discloseAddressToAdministrator(
  db: Executor,
  bookingId: string,
  adminUserId: string,
  reason: string,
): Promise<AddressDisclosure> {
  if (reason.trim().length < 10) {
    throw new AddressAccessError(
      'a written reason of at least 10 characters is required to disclose an address to an ' +
        'administrator; the reason is recorded in the audit log (SEC-3, NFR-19)',
    );
  }

  const booking = await getBookingOrThrow(db, bookingId);
  const ciphertext = await findBookingAddressCiphertext(db, bookingId);

  await appendAdminAction(db, {
    adminUserId,
    action: 'booking.address_disclosed',
    targetType: 'booking',
    targetId: bookingId,
    detailJson: { reason: reason.trim(), bookingStatus: booking.status },
  });

  if (!ciphertext) {
    return {
      visibility: 'area_only',
      areaId: booking.areaId,
      address: null,
      reason: 'No address has been recorded for this booking.',
    };
  }

  return {
    visibility: 'full',
    areaId: booking.areaId,
    address: decrypt(ciphertext),
    reason: null,
  };
}
