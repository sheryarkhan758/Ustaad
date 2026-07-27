// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/verification.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verification integrity — §6.6, §6.28.
 *
 * The platform's central claim is that it verified the people it shows you, so
 * the chain of custody has to be a record rather than a status field: who
 * decided, when, against which artefacts, and on what reasoning. A boolean
 * `verified` column could not answer any of those.
 *
 * ── Two independent tracks (FR-6.2) ────────────────────────────────────────
 *  · **Identity** — an administrator, manually, against a CNIC and academic
 *    documents. Gates searchability (FR-6.3). No stated expiry.
 *  · **Competency** — an AI assessment, per topic. Expires at twelve months
 *    (FR-28.1). Does **not** gate searchability.
 *
 * They are displayed separately and never merged into one badge. An expired
 * competency badge therefore leaves the tutor searchable and unbadged, which is
 * what §6.28 describes and what the expiry job implements.
 */

import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, jsonCol, pk, timestampCol } from './_common';
import { users } from './identity';
import { tutorProfiles, tutorSubjectClaims } from './tutor';

export const VERIFICATION_TRACKS = ['identity', 'competency'] as const;
export type VerificationTrack = (typeof VERIFICATION_TRACKS)[number];

/**
 * `more_info_needed` is a decision, not a non-decision: it is written, reasoned
 * and audited like the other two, because from the tutor's side it is an
 * outcome that leaves them unable to work.
 */
export const VERIFICATION_DECISIONS = [
  'approved',
  'rejected',
  'more_info_needed',
  'expired',
  'overridden',
] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/**
 * One row per administrator decision, ever. **Never updated.**
 *
 * A later decision supersedes an earlier one by pointing at it through
 * `supersedesId`; the earlier row stays exactly as written. That is what makes
 * the public verification history in FR-6.9 and FR-28.9 truthful — it is the
 * decisions themselves, not a summary that could have been rewritten.
 */
export const verificationRecords = pgTable(
  'verification_records',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    track: text('track', { enum: VERIFICATION_TRACKS }).notNull(),
    decision: text('decision', { enum: VERIFICATION_DECISIONS }).notNull(),

    /**
     * Exactly which artefacts were checked, itemised (FR-6.5).
     *
     * A JSON array of `cnic` | `degree` | `transcript`. This is what the public
     * badge is generated from, so "verified" can never mean more on the profile
     * than the administrator actually looked at.
     */
    artefactsCheckedJson: jsonCol('artefacts_checked_json').notNull(),

    /** The approving administrator. Attribution is not optional (FR-6.6). */
    decidedBy: text('decided_by')
      .notNull()
      .references(() => users.id),
    decidedAt: text('decided_at').notNull(),
    /** Written reason. Required for every decision, including approval. */
    reason: text('reason').notNull(),

    /** ISO `YYYY-MM-DD`. Set on a competency approval (FR-28.1). */
    expiresOn: text('expires_on'),

    /** The competency claim this concerns. Null for an identity decision. */
    claimId: text('claim_id').references(() => tutorSubjectClaims.id, { onDelete: 'cascade' }),

    /** The earlier record this one replaces. The earlier row is not touched. */
    supersedesId: text('supersedes_id'),

    createdAt: createdAt(),
  },
  (t) => [
    // "What has been decided about this tutor?" — the chain of custody read.
    index('idx_verification_records_tutor').on(t.tutorId, t.track, t.decidedAt),
    // The expiry sweep (FR-28.1).
    index('idx_verification_records_expiry').on(t.track, t.decision, t.expiresOn),
    index('idx_verification_records_admin').on(t.decidedBy, t.decidedAt),
  ],
);

/**
 * Salted CNIC hashes, for duplicate detection only — FR-28.7, SEC-8, NFR-10.
 *
 * **The CNIC number itself is never stored, anywhere, in any column.** What is
 * stored is a salted SHA-256 digest, which supports exactly one question — "has
 * this identity document been used on another account?" — and supports no
 * other. It cannot be searched by number, cannot be reversed to a number, and
 * cannot be shown to anybody.
 *
 * The hash is deliberately **not unique**: a collision is *flagged to an
 * administrator*, not auto-rejected. Two accounts sharing a CNIC is usually
 * fraud and occasionally a family member re-registering after a failed signup,
 * and a machine cannot tell those apart. Auto-rejecting would lock out the
 * second case with no recourse.
 */
export const cnicRegistrations = pgTable(
  'cnic_registrations',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    /** Salted SHA-256, hex. Never the number. */
    cnicHash: text('cnic_hash').notNull(),
    /** Which salt produced it, so the salt can be rotated. */
    saltVersion: text('salt_version').notNull().default('v1'),
    createdAt: createdAt(),
  },
  (t) => [
    // Not unique — see the note above. Indexed, because the collision lookup
    // runs on every submission.
    index('idx_cnic_registrations_hash').on(t.cnicHash),
    uniqueIndex('idx_cnic_registrations_tutor').on(t.tutorId),
  ],
);

export const APPEAL_STATUSES = ['open', 'upheld', 'dismissed', 'withdrawn'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/**
 * An appeal against a rejection or a failed competency verdict — §6.28, SEC-18.
 *
 * Decision 12: *an automated verdict affecting a livelihood must not be final.*
 * The platform withholds a badge that determines whether someone can earn, on
 * the basis of an assessment a model produced. An unappealable machine verdict
 * on a person's professional competence would be indefensible, so this table is
 * not a courtesy feature.
 *
 * FR-28.3: appealable **once**, after a **seven-day cooling period**.
 * FR-28.4: the prior attempt is retained and never overwritten.
 */
export const verificationAppeals = pgTable(
  'verification_appeals',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    track: text('track', { enum: VERIFICATION_TRACKS }).notNull(),
    /** The record being appealed. Retained untouched (FR-28.4). */
    againstRecordId: text('against_record_id')
      .notNull()
      .references(() => verificationRecords.id),
    claimId: text('claim_id').references(() => tutorSubjectClaims.id, { onDelete: 'cascade' }),

    /** The tutor's own words, any script, stored unchanged (§2.10). */
    tutorReason: text('tutor_reason').notNull(),

    /** ISO-8601. The appeal cannot be filed before this (FR-28.3). */
    eligibleFrom: text('eligible_from').notNull(),

    status: text('status', { enum: APPEAL_STATUSES }).notNull().default('open'),

    /** The administrator who overrode, and why. Stored permanently (FR-28.6). */
    decidedBy: text('decided_by').references(() => users.id),
    decisionReason: text('decision_reason'),
    decidedAt: timestampCol('decided_at'),

    createdAt: createdAt(),
  },
  (t) => [
    // The administrator appeal queue (FR-28.6), oldest first.
    index('idx_appeals_queue').on(t.status, t.createdAt),
    // FR-28.3: one appeal per decision.
    uniqueIndex('idx_appeals_against_record').on(t.againstRecordId),
    index('idx_appeals_tutor').on(t.tutorId, t.status),
  ],
);

export const NOTIFICATION_KINDS = [
  'verification_approved',
  'verification_rejected',
  'verification_more_info',
  'badge_expiring',
  'badge_expired',
  'appeal_decided',
  'duplicate_cnic_review',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * In-application notifications — FR-28.2.
 *
 * Not in §9 of the specification; added because FR-28.2 requires the tutor to
 * be told thirty days before a badge expires, and §4.2 rules out push
 * notification infrastructure. In-application is what remains, and it needs
 * somewhere to live.
 *
 * The body is authored copy, never a badge string and never a document
 * reference.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Deep link within the application. Never an external URL. */
    linkPath: text('link_path'),
    readAt: timestampCol('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_notifications_user').on(t.userId, t.readAt, t.createdAt),
    // The expiry job checks whether it has already warned about this badge.
    index('idx_notifications_kind').on(t.userId, t.kind),
  ],
);

/** Kept for the deduplication check in the expiry job. */
export const notificationDedupe = pgTable(
  'notification_dedupe',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `badge_expiring:<claimId>:<expiresOn>` — stable across runs. */
    dedupeKey: text('dedupe_key').notNull(),
    sentAt: text('sent_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idx_notification_dedupe_key').on(t.dedupeKey)],
);

export type VerificationRecord = typeof verificationRecords.$inferSelect;
export type CnicRegistration = typeof cnicRegistrations.$inferSelect;
export type VerificationAppeal = typeof verificationAppeals.$inferSelect;
export type Notification = typeof notifications.$inferSelect;

/** Competency badges lapse twelve months after issue (FR-28.1). */
export const COMPETENCY_BADGE_MONTHS = 12;
/** The tutor is warned this many days before (FR-28.2). */
export const EXPIRY_WARNING_DAYS = 30;
/** A failed verification may be appealed once, after this cooling period (FR-28.3). */
export const APPEAL_COOLING_DAYS = 7;
