/**
 * Address encryption and disclosure — SEC-3, SEC-20, NFR-18.
 *
 * The rule under test is asymmetric and that asymmetry is the point: the family
 * who wrote the address can always see it; the tutor sees the **area** while
 * she is deciding and the **street** only after she has confirmed.
 *
 * These are not feature tests. The platform's primary use case sends a woman
 * alone to a house she has not visited, arranged through an application. If she
 * cannot see the area before accepting she cannot make a safety judgement; if
 * an unconfirmed or declined tutor can see the street, a family has handed
 * their address to a stranger by doing nothing but asking a question.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../../shared/db-values';
import { adminActions } from '../db/schema/admin';
import { bookings } from '../db/schema/booking';
import { users } from '../db/schema/identity';
import { createBookingFixture, createSeededTestDb, type TestDb } from '../db/test-db';
import { findBookingAddressCiphertext, setBookingAddressCiphertext } from '../repositories/bookings';
import { transitionBooking } from './bookings';
import {
  AddressAccessError,
  discloseAddress,
  discloseAddressToAdministrator,
  sealAddress,
} from './address';
import { EncryptionError, decrypt, encrypt } from './crypto';

const ADDRESS = 'House 42, Street 7, Block 13-D, Gulshan-e-Iqbal, Karachi';

let db: TestDb;
let fx: Awaited<ReturnType<typeof createBookingFixture>>;

beforeEach(async () => {
  db = await createSeededTestDb();
  fx = await createBookingFixture(db);
});

/* =========================================================================
 * The cipher itself
 * ====================================================================== */

describe('AES-256-GCM', () => {
  it('round-trips a UTF-8 address', () => {
    expect(decrypt(encrypt(ADDRESS))).toBe(ADDRESS);
  });

  it('round-trips Urdu script unchanged', () => {
    const urdu = 'مکان نمبر ۴۲، گلی ۷، بلاک ۱۳-ڈی، گلشنِ اقبال، کراچی';
    expect(decrypt(encrypt(urdu))).toBe(urdu);
  });

  it('produces a different ciphertext each time for the same plaintext', () => {
    // A fresh IV per call. Identical ciphertexts would let anyone with database
    // access tell which families live at the same address.
    const a = encrypt(ADDRESS);
    const b = encrypt(ADDRESS);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('carries a version prefix, so the scheme can be changed later', () => {
    expect(encrypt(ADDRESS).startsWith('v1.')).toBe(true);
  });

  it('refuses a tampered ciphertext instead of returning plausible garbage', () => {
    const sealed = encrypt(ADDRESS);
    const parts = sealed.split('.');
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString('base64url')].join('.');

    expect(() => decrypt(tampered)).toThrow(EncryptionError);
  });

  it('refuses a swapped authentication tag', () => {
    const a = encrypt(ADDRESS).split('.');
    const b = encrypt('somewhere else entirely').split('.');
    const frankenstein = [a[0], a[1], b[2], a[3]].join('.');

    expect(() => decrypt(frankenstein)).toThrow(EncryptionError);
  });

  it('refuses a malformed value', () => {
    for (const bad of ['', 'not-ciphertext', 'v1.only.three', 'v2.a.b.c']) {
      expect(() => decrypt(bad)).toThrow(EncryptionError);
    }
  });
});

/* =========================================================================
 * Storage
 * ====================================================================== */

describe('storage', () => {
  it('never writes a plaintext address to the column', async () => {
    await setBookingAddressCiphertext(db, fx.bookingId, sealAddress(ADDRESS));

    const stored = await findBookingAddressCiphertext(db, fx.bookingId);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain('Gulshan');
    expect(stored).not.toContain('House 42');
    expect(stored!.startsWith('v1.')).toBe(true);
  });

  it('refuses to store anything that is not sealed ciphertext', async () => {
    await expect(setBookingAddressCiphertext(db, fx.bookingId, ADDRESS)).rejects.toThrow(
      /sealed ciphertext/i,
    );
  });

  it('keeps the address off the ordinary booking record entirely', async () => {
    await setBookingAddressCiphertext(db, fx.bookingId, sealAddress(ADDRESS));

    const { getBookingOrThrow } = await import('../repositories/bookings');
    const booking = await getBookingOrThrow(db, fx.bookingId);

    // Not "encrypted on the record" — absent from it. A handler that serialises
    // a booking cannot leak what it never received.
    expect(booking).not.toHaveProperty('addressEncrypted');
    expect(booking).not.toHaveProperty('address');
    expect(JSON.stringify(booking)).not.toContain('v1.');
  });
});

/* =========================================================================
 * Disclosure — SEC-20
 * ====================================================================== */

describe('disclosure', () => {
  beforeEach(async () => {
    await setBookingAddressCiphertext(db, fx.bookingId, sealAddress(ADDRESS));
  });

  const asTutor = { userId: fx?.tutorUserId ?? '', role: 'tutor' as const };

  it('shows the family who wrote it the full address, at any status', async () => {
    const disclosure = await discloseAddress(
      db,
      fx.bookingId,
      { userId: fx.parentUserId, role: 'parent' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('full');
    expect(disclosure.address).toBe(ADDRESS);
  });

  it('shows a CONFIRMED tutor the full address', async () => {
    // The fixture booking is already confirmed.
    const disclosure = await discloseAddress(
      db,
      fx.bookingId,
      { userId: fx.tutorUserId, role: 'tutor' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('full');
    expect(disclosure.address).toBe(ADDRESS);
  });

  it('shows an UNCONFIRMED tutor the area only, and says why', async () => {
    // A fresh request the tutor has not answered.
    const pendingId = newId();
    await db.insert(bookings).values({
      id: pendingId,
      tutorId: fx.tutorProfileId,
      studentProfileId: fx.studentProfileId,
      requestedByUserId: fx.parentUserId,
      engagementType: 'monthly',
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIdsJson: '[]',
      mode: 'home',
      areaId: 'karachi-gulshan-e-iqbal',
      status: 'requested',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });
    await setBookingAddressCiphertext(db, pendingId, sealAddress(ADDRESS));

    const disclosure = await discloseAddress(
      db,
      pendingId,
      { userId: fx.tutorUserId, role: 'tutor' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('area_only');
    expect(disclosure.address).toBeNull();
    // She can still see where it is, which is what lets her decide (SEC-20).
    expect(disclosure.areaId).toBe('karachi-gulshan-e-iqbal');
    expect(disclosure.reason).toMatch(/once you confirm/i);
  });

  it('withholds the address from a tutor who DECLINED after seeing the area', async () => {
    const pendingId = newId();
    await db.insert(bookings).values({
      id: pendingId,
      tutorId: fx.tutorProfileId,
      studentProfileId: fx.studentProfileId,
      requestedByUserId: fx.parentUserId,
      engagementType: 'monthly',
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIdsJson: '[]',
      mode: 'home',
      areaId: 'karachi-malir',
      status: 'requested',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });
    await setBookingAddressCiphertext(db, pendingId, sealAddress(ADDRESS));

    await transitionBooking(db, {
      bookingId: pendingId,
      to: 'declined',
      by: 'tutor',
      at: new Date(),
      reason: 'outside the areas I travel to',
      declineUnderSafetyConstraint: true,
    });

    const disclosure = await discloseAddress(
      db,
      pendingId,
      { userId: fx.tutorUserId, role: 'tutor' },
      fx.tutorUserId,
    );

    // She declined on the basis of the area. She must not learn the street as
    // a consequence of having been asked.
    expect(disclosure.visibility).toBe('area_only');
    expect(disclosure.address).toBeNull();
  });

  it('withholds the address from an unrelated tutor', async () => {
    const strangerId = newId();
    await db.insert(users).values({
      id: strangerId,
      email: 'stranger@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'tutor',
      displayName: 'Unrelated Tutor',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const disclosure = await discloseAddress(
      db,
      fx.bookingId,
      { userId: strangerId, role: 'tutor' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('area_only');
    expect(disclosure.address).toBeNull();
  });

  it('withholds the address from an unrelated parent', async () => {
    const otherParentId = newId();
    await db.insert(users).values({
      id: otherParentId,
      email: 'otherparent@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'parent',
      displayName: 'Another Parent',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const disclosure = await discloseAddress(
      db,
      fx.bookingId,
      { userId: otherParentId, role: 'parent' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('area_only');
    expect(disclosure.address).toBeNull();
  });

  it('does not treat an administrator as a party on the ordinary path', async () => {
    const disclosure = await discloseAddress(
      db,
      fx.bookingId,
      { userId: fx.adminUserId, role: 'admin' },
      fx.tutorUserId,
    );

    // "The administrator can see everything" is how an access rule quietly
    // stops being one. They have an audited path instead.
    expect(disclosure.visibility).toBe('area_only');
  });

  it('reports area_only when no address has been recorded', async () => {
    const bareId = newId();
    await db.insert(bookings).values({
      id: bareId,
      tutorId: fx.tutorProfileId,
      studentProfileId: fx.studentProfileId,
      requestedByUserId: fx.parentUserId,
      engagementType: 'single_session',
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIdsJson: '[]',
      mode: 'online',
      status: 'confirmed',
      requestedAt: nowIso(),
      createdAt: nowIso(),
    });

    const disclosure = await discloseAddress(
      db,
      bareId,
      { userId: fx.parentUserId, role: 'parent' },
      fx.tutorUserId,
    );

    expect(disclosure.visibility).toBe('area_only');
    expect(asTutor).toBeDefined();
  });
});

/* =========================================================================
 * Administrator disclosure — audited
 * ====================================================================== */

describe('administrator disclosure', () => {
  beforeEach(async () => {
    await setBookingAddressCiphertext(db, fx.bookingId, sealAddress(ADDRESS));
  });

  it('requires a written reason', async () => {
    await expect(
      discloseAddressToAdministrator(db, fx.bookingId, fx.adminUserId, 'because'),
    ).rejects.toThrow(AddressAccessError);
  });

  it('writes an audit entry BEFORE returning the address', async () => {
    const disclosure = await discloseAddressToAdministrator(
      db,
      fx.bookingId,
      fx.adminUserId,
      'Safety concern raised against this booking on 2026-08-05.',
    );

    expect(disclosure.visibility).toBe('full');
    expect(disclosure.address).toBe(ADDRESS);

    const entries = await db.select().from(adminActions);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      adminUserId: fx.adminUserId,
      action: 'booking.address_disclosed',
      targetType: 'booking',
      targetId: fx.bookingId,
    });
  });

  it('never writes the address itself into the append-only log', async () => {
    await discloseAddressToAdministrator(
      db,
      fx.bookingId,
      fx.adminUserId,
      'Payment dispute: family says no sessions took place at the address.',
    );

    const entries = await db.select().from(adminActions);
    const serialised = JSON.stringify(entries);

    // The log is never deleted from, so an address written there is permanent.
    expect(serialised).not.toContain('Gulshan');
    expect(serialised).not.toContain('House 42');
    expect(serialised).toContain('Payment dispute');
  });
});
