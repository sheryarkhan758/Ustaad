// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/booking.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Booking and engagement — specification §9.5.
 *
 * ── Reconciling the two column lists ───────────────────────────────────────
 * The task brief and §9.5 name overlapping but not identical column sets.  This
 * file is the union of both, with no column invented:
 *
 *  · Names follow the brief where the two describe the same field
 *    (`requested_by_user_id` for §9.5 `requester_user_id`, `topic_ids_json` for
 *    `topics_json`, `guardian_presence_required` for `guardian_presence`).
 *  · Every §9.5 column the brief omits is present: `service_type_id`,
 *    `session_purpose`, `package_sessions_total/used`, `slot_start`,
 *    `slot_end`, `agreed_rate`, `rate_type`, `travel_charge_agreed`,
 *    `address_encrypted`, `group_id`, `status_changed_by`,
 *    `status_changed_at`, `responded_at`.
 *  · Every brief column §9.5 omits is present: `area_id`,
 *    `agreed_rate_snapshot_json`, `confirmed_at`, `completed_at`,
 *    `cancelled_at`, `cancel_reason`.
 *
 * `agreed_rate` / `rate_type` / `travel_charge_agreed` and
 * `agreed_rate_snapshot_json` are both kept and are not redundant: the scalars
 * are what statements and dispute views query, the JSON is the frozen copy of
 * the whole `tutor_rates` row as it stood at confirmation, which is what makes
 * FR-31.1's immutability claim auditable after the tutor edits their pricing.
 *
 * ── Status ─────────────────────────────────────────────────────────────────
 * Transitions live in `shared/booking-status.ts` and are enforced by the
 * service layer on every write.  Not in the UI (NFR-6).
 */

import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { EMPTY_JSON_ARRAY, EMPTY_JSON_OBJECT, nowIso } from '../../../shared/db-values';
import { boolCol, createdAt, jsonCol, paisa, pk, timestampCol } from './_common';

import { BOOKING_ACTORS, BOOKING_STATUSES } from '../../../shared/booking-status';
import { RATE_TYPES, TEACHING_MODES } from '../../../shared/rates';
import { studentProfiles, users } from './identity';
import { areas, boards, levels, serviceTypes, subjects } from './reference';
import { tutorProfiles } from './tutor';

/**
 * Engagement shape (§6.30, decision 19).
 *
 * The brief names three (`monthly`, `single_session`, `group`); §9.5 and §6.30
 * describe monthly, short-term package and single session.  Both are kept —
 * dropping `short_term_package` would strand the `package_sessions_*` columns
 * §9.5 specifies, and dropping `group` would strand `group_id`.
 */
export const ENGAGEMENT_TYPES = [
  'monthly',
  'short_term_package',
  'single_session',
  'group',
] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

/** Declared purpose of a single session (FR-30.4). */
export const SESSION_PURPOSES = [
  'concept_clarification',
  'assessment_review',
  'doubt_solving',
  'exam_revision',
] as const;
export type SessionPurpose = (typeof SESSION_PURPOSES)[number];

export const bookings = pgTable(
  'bookings',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id),
    /**
     * The learner.  For a minor this is a parent-owned profile and
     * `requested_by_user_id` is the parent — there is no path by which a minor
     * is the requester, because a minor has no account (SEC-1, SEC-2).
     */
    studentProfileId: text('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id),
    /** The account that raised the request: a parent, or an adult student. */
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => users.id),

    engagementType: text('engagement_type', { enum: ENGAGEMENT_TYPES }).notNull(),
    /** Set only for `single_session` (FR-30.4). */
    sessionPurpose: text('session_purpose', { enum: SESSION_PURPOSES }),
    /** Set only for `short_term_package` (FR-30.10). */
    packageSessionsTotal: integer('package_sessions_total'),
    packageSessionsUsed: integer('package_sessions_used').notNull().default(0),

    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    /** Board is part of the engagement, not a detail of it (decision 5). */
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    topicIdsJson: jsonCol('topic_ids_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    serviceTypeId: text('service_type_id').references(() => serviceTypes.id),

    mode: text('mode', { enum: TEACHING_MODES }).notNull(),
    /** Area only.  The finest location granularity in this system (§4.2). */
    areaId: text('area_id').references(() => areas.id),
    /**
     * AES ciphertext of the delivery address (SEC-3, NFR-18, FR-8.5).
     *
     * Captured on a **confirmed** booking, never before — the tutor sees the
     * locality and decides, and only then is the exact address disclosed
     * (SEC-20). Readable by the two parties to this booking and by nobody else.
     * Never logged, never joined into a public response.
     */
    addressEncrypted: text('address_encrypted'),

    slotStart: timestampCol('slot_start'),
    slotEnd: timestampCol('slot_end'),

    /** Paisa. Frozen at confirmation and immutable thereafter (FR-31.1). */
    agreedRate: paisa('agreed_rate'),
    rateType: text('rate_type', { enum: RATE_TYPES }),
    /** Paisa. A separate recorded line, never folded into the rate (FR-31.2). */
    travelChargeAgreed: paisa('travel_charge_agreed').notNull().default(0),
    /** The whole `tutor_rates` row as it stood at confirmation. Audit copy. */
    agreedRateSnapshotJson: jsonCol('agreed_rate_snapshot_json'),

    /** The first booking between a tutor and a student is a trial (FR-8.10). */
    isTrial: boolCol('is_trial').notNull().default(0),
    /** FR-8.9, FR-29.11 — required by the family, or by the tutor, or both. */
    guardianPresenceRequired: boolCol('guardian_presence_required')
      .notNull().default(0),
    /** Shared identifier linking the bookings of one confirmed group (FR-23.6). */
    groupId: text('group_id'),

    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('requested'),
    statusChangedBy: text('status_changed_by', { enum: BOOKING_ACTORS }),
    statusChangedAt: timestampCol('status_changed_at'),

    requestedAt: timestampCol('requested_at')
      .notNull()
      .$defaultFn(nowIso),
    /** First tutor response, confirm or decline. Feeds median response time. */
    respondedAt: timestampCol('responded_at'),
    confirmedAt: timestampCol('confirmed_at'),
    completedAt: timestampCol('completed_at'),
    cancelledAt: timestampCol('cancelled_at'),
    cancelReason: text('cancel_reason'),

    /**
     * Set when a tutor declines under a declared safety constraint
     * (SEC-19–21, FR-29.14).
     *
     * It must be recorded at the moment of the decline, because it cannot be
     * reconstructed afterwards, and because the reliability job excludes these
     * rows from the confirmation-rate denominator.  A woman must not be
     * penalised in a public statistic for holding to her own conditions.
     */
    declineUnderSafetyConstraint: boolCol('decline_under_safety_constraint')
      .notNull().default(0),

    createdAt: createdAt(),
  },
  (t) => [
    // Tutor's own queue, and the reliability recompute job.
    index('idx_bookings_tutor_status').on(t.tutorId, t.status),
    // "My bookings" for a parent or adult student.
    index('idx_bookings_requester').on(t.requestedByUserId, t.status),
    index('idx_bookings_student').on(t.studentProfileId, t.status),
    // Slot-conflict check (FR-8.6) — tutor's live bookings in a time window.
    index('idx_bookings_slot').on(t.tutorId, t.slotStart, t.slotEnd),
    // Group bookings resolved as a unit (FR-23.6).
    index('idx_bookings_group').on(t.groupId),
    // Administrator queues and the progress ledger.
    index('idx_bookings_status_requested').on(t.status, t.requestedAt),
  ],
);

/**
 * Progress ledger entries — §6.12, FR-12.1.
 *
 * Written by the tutor after a completed booking.  Visible to the tutor who
 * wrote it, to the parent or adult student who owns the engagement, and to
 * administrators.  `mastery_ratings_json` is a topic-id → 1–5 map.
 *
 * The mastery curve the parent sees is assembled **in the request** by
 * `server/services/progress-ledger.ts`, not by a background job.  That reverses
 * what this comment previously claimed, and the reasoning is set out in full at
 * the top of that module: §2.8 exists to keep aggregate computation off the
 * NFR-1 search path and out of the four materialised tables it names, and this
 * is neither — it is one family reading one child's own notes, where a figure
 * that is a night old is worse than no figure at all.
 */
export const sessionNotes = pgTable(
  'session_notes',
  {
    id: pk(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id),
    topicsCoveredJson: jsonCol('topics_covered_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** `{ [topicId]: 1..5 }` */
    masteryRatingsJson: jsonCol('mastery_ratings_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_OBJECT),
    /** Free text, any script.  Stored unchanged, never translated (§2.10). */
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_session_notes_booking').on(t.bookingId),
    index('idx_session_notes_tutor').on(t.tutorId, t.createdAt),
  ],
);

/**
 * Trial fit check — §6.20, SEC-15.
 *
 * **PRIVATE to the requesting family and to administrators.**  Never surfaced
 * on a public profile, never shown to the tutor, never joined into a search
 * result, and never an input to ranking.  That privacy is what keeps it
 * candid — a family that expects the tutor to read it writes nothing useful.
 *
 * One per booking, hence the unique constraint.
 */
export const trialFitChecks = pgTable(
  'trial_fit_checks',
  {
    id: pk(),
    bookingId: text('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => users.id),
    /** Each 1–5. */
    communication: integer('communication').notNull(),
    punctuality: integer('punctuality').notNull(),
    engagement: integer('engagement').notNull(),
    pace: integer('pace').notNull(),
    /** Whether the family intends to continue into an ongoing arrangement. */
    continueDecision: boolCol('continue_decision').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_trial_fit_checks_booking').on(t.bookingId),
    index('idx_trial_fit_checks_submitter').on(t.submittedBy),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type SessionNote = typeof sessionNotes.$inferSelect;
export type TrialFitCheck = typeof trialFitChecks.$inferSelect;

/**
 * Slot reservations — the double-booking guarantee (FR-8.6).
 *
 * One row per **live** booking, with a unique index on
 * `(tutor_id, slot_start)`. That constraint, not application logic, is what
 * makes two concurrent requests for the same slot resolve to one winner: the
 * loser's insert violates the index and is refused by the database.
 *
 * A separate table rather than a partial unique index on `bookings`, because a
 * partial index is spelled differently in SQLite and Postgres and
 * `PORTABILITY.md` rule 6 rules those out. Here the "only live bookings" part
 * is expressed by which rows exist: the row is deleted when a booking is
 * cancelled, declined or completed, freeing the slot.
 */
export const bookingSlotReservations = pgTable(
  'booking_slot_reservations',
  {
    id: pk(),
    bookingId: text('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    /** ISO-8601 UTC. The instant the session begins. */
    slotStart: text('slot_start').notNull(),
    slotEnd: text('slot_end').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // The constraint the concurrency test relies on.
    uniqueIndex('idx_slot_reservation_unique').on(t.tutorId, t.slotStart),
    uniqueIndex('idx_slot_reservation_booking').on(t.bookingId),
    // The slot-generation sweep: this tutor's live slots in a date range.
    index('idx_slot_reservation_range').on(t.tutorId, t.slotStart, t.slotEnd),
  ],
);

export type BookingSlotReservation = typeof bookingSlotReservations.$inferSelect;
