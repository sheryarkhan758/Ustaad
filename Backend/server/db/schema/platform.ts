/**
 * Platform feedback and the volunteer programme — specification §9.10, §6.32, §6.33.
 *
 * New in specification v4.0.  Two tables that look similar and are not:
 *
 *  · `platform_feedback` is what a user says about **Ustaad.com itself** — the
 *    search that returned nothing useful, the AI output that was wrong, the
 *    Urdu view that broke a layout.  It is deliberately kept apart from tutor
 *    reviews (§6.9): merging them would let a complaint about a broken layout
 *    depress a tutor's rating, and let a genuine concern about a tutor be
 *    triaged as a defect and closed (decision 20).
 *
 *  · `volunteer_applications` is a supply channel.  A volunteer is verified on
 *    exactly the same basis as a paid tutor — CNIC and academic documents,
 *    under §6.6.  **The fee is what differs, not the standard** (FR-33.10);
 *    goodwill is never a loophole in the platform's central claim.
 *
 * Both tables are written **before** their EmailJS dispatch, and the dispatch
 * outcome is recorded against the row (FR-33.9, decision 22).  EmailJS is a
 * notification channel, not a system of record: a quota reached or a template
 * renamed must never discard a submission the applicant believes was received.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { EMPTY_JSON_ARRAY } from '../../../shared/db-values';
import { boolCol, createdAt, jsonCol, pk, timestampCol } from './_common';

import { GENDERS, USER_ROLES, users } from './identity';
import { areas, cities, LANGS } from './reference';
import { tutorProfiles } from './tutor';

/** FR-32.2. */
export const FEEDBACK_CATEGORIES = [
  'defect',
  'usability',
  'incorrect_ai_output',
  'missing_feature',
  'content_or_safety',
  'other',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'actioned', 'declined'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** EmailJS outcome, recorded against the row that already exists (FR-33.9). */
export const MAIL_DISPATCH_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type MailDispatchStatus = (typeof MAIL_DISPATCH_STATUSES)[number];

/**
 * Feedback about the platform — §6.32.
 *
 * **Administrators only.  Never displayed on any public surface, never visible
 * to tutors, never an input to ranking or to any published statistic**
 * (FR-32.10, SEC-26).  That confidentiality is what makes candour possible: a
 * user who suspects their complaint will be shown to the tutor writes nothing.
 */
export const platformFeedback = sqliteTable(
  'platform_feedback',
  {
    id: pk(),
    /**
     * NULL for an anonymous submission (FR-32.6).  An anonymous record carries
     * no identity fields at all — not a name, not an email, not an IP.  Rate
     * limiting is the abuse control, not identification.
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Role at the time of submission.  Nullable for an anonymous visitor. */
    role: text('role', { enum: USER_ROLES }),
    category: text('category', { enum: FEEDBACK_CATEGORIES }).notNull(),
    /**
     * Free text.  Urdu script, Roman Urdu and mixed-language text are accepted
     * and **stored unchanged; never machine translated** (FR-32.3, decision 13).
     */
    detail: text('detail').notNull(),
    /** Optional 1–5 (FR-32.2). */
    satisfactionRating: integer('satisfaction_rating'),

    /** Captured automatically so a defect can be reproduced without
     *  interrogating the reporter (FR-32.4). */
    pagePath: text('page_path'),
    locale: text('locale', { enum: LANGS }),
    appVersion: text('app_version'),

    /**
     * Screenshot or document in the **private** bucket, referenced by signed
     * URL (FR-32.5).  Never a public URL, never a repository path — validated
     * by `shared/storage-path.ts`.
     */
    attachmentPath: text('attachment_path'),

    /**
     * Escalated in the queue and handled exactly as FR-9.8 requires: never
     * shown publicly, and never disclosed to the tutor concerned in a form
     * that identifies the reporter (FR-32.8).
     */
    safetyConcernFlag: boolCol('safety_concern_flag')
      .notNull().default(0),

    status: text('status', { enum: FEEDBACK_STATUSES }).notNull().default('new'),
    /** Internal note.  Administrator-facing only. */
    dispositionNote: text('disposition_note'),
    triagedBy: text('triaged_by').references(() => users.id),
    triagedAt: timestampCol('triaged_at'),
    mailDispatchStatus: text('mail_dispatch_status', { enum: MAIL_DISPATCH_STATUSES })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    // The administrator triage queue (FR-32.7).
    index('idx_platform_feedback_queue').on(t.status, t.createdAt),
    // Safety concerns jump the queue (FR-32.8).
    index('idx_platform_feedback_safety').on(t.safetyConcernFlag, t.status, t.createdAt),
    index('idx_platform_feedback_user').on(t.userId),
    index('idx_platform_feedback_category').on(t.category, t.createdAt),
    // Retry sweep for failed EmailJS dispatches (FR-33.9 pattern).
    index('idx_platform_feedback_dispatch').on(t.mailDispatchStatus),
  ],
);

export const VOLUNTEER_STATUSES = [
  'received',
  'contacted',
  'verified',
  'active',
  'declined',
  'withdrawn',
] as const;
export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number];

/**
 * Volunteer tutor application — §6.33.
 *
 * Publicly reachable without an account (FR-33.1), so this table holds contact
 * details for people who are not yet users.  It is administrator-facing only.
 *
 * `status` reaching `verified` means the applicant passed §6.6 identity
 * verification against CNIC and academic documents — the same bar as a paid
 * tutor.  `convertedTutorId` links to the tutor profile created on approval,
 * which carries the volunteer flag and a zero rate (FR-33.10).
 */
export const volunteerApplications = sqliteTable(
  'volunteer_applications',
  {
    id: pk(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    /** Contact number.  Never written to a log (CLAUDE.md §2.2). */
    phone: text('phone'),
    cityId: text('city_id').references(() => cities.id),
    areaId: text('area_id').references(() => areas.id),
    gender: text('gender', { enum: GENDERS }),
    subjectsJson: jsonCol('subjects_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    levelsJson: jsonCol('levels_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** Availability cap, enforced at booking so a volunteer cannot be
     *  over-committed (FR-33.11). */
    weeklyHours: integer('weekly_hours'),
    deliveryModesJson: jsonCol('delivery_modes_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** Free text, any script.  Stored unchanged, never translated (§2.10). */
    motivation: text('motivation'),
    /**
     * CV or transcript PDF in the **private** bucket, never publicly
     * addressable, opened by an administrator through a short-lived signed URL
     * (FR-33.4, SEC-24).  Optional at submission, mandatory before approval
     * (FR-33.3).
     */
    documentPath: text('document_path'),
    status: text('status', { enum: VOLUNTEER_STATUSES }).notNull().default('received'),
    mailDispatchStatus: text('mail_dispatch_status', { enum: MAIL_DISPATCH_STATUSES })
      .notNull()
      .default('pending'),
    reviewedBy: text('reviewed_by').references(() => users.id),
    reviewNote: text('review_note'),
    /** Set on approval — the volunteer's tutor profile (FR-33.10). */
    convertedTutorId: text('converted_tutor_id').references(() => tutorProfiles.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Administrator review queue.
    index('idx_volunteer_applications_queue').on(t.status, t.createdAt),
    // Duplicate-application lookup.
    index('idx_volunteer_applications_email').on(t.email),
    // Supply-gap view: where volunteers are offering (§6.29 is thinnest here).
    index('idx_volunteer_applications_area').on(t.cityId, t.areaId, t.status),
    // Retry sweep for failed EmailJS dispatches (FR-33.9).
    index('idx_volunteer_applications_dispatch').on(t.mailDispatchStatus),
  ],
);

export type PlatformFeedback = typeof platformFeedback.$inferSelect;
export type NewPlatformFeedback = typeof platformFeedback.$inferInsert;
export type VolunteerApplication = typeof volunteerApplications.$inferSelect;
