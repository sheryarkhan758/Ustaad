/**
 * Tutor — specification §9.3.
 *
 * ── Money ──────────────────────────────────────────────────────────────────
 * Every monetary column below is an **integer count of paisa** (1 PKR = 100
 * paisa).  Never a float, never a decimal string.  Conversion happens at the
 * interface boundary via `shared/rates.ts`.
 *
 * ── Claims are not competence ──────────────────────────────────────────────
 * `tutor_subject_claims` records what a tutor *says* they can teach.  §2.2 of
 * the specification is entirely about the gap between that and what they can
 * demonstrate.  A claim becomes evidence only when Agent 2 has assessed it and
 * the row's `claimStatus` says so — no query may treat `claimed` as verified.
 *
 * ── Safety runs both ways ──────────────────────────────────────────────────
 * `tutor_safety_constraints` exists because the platform's primary use case
 * sends a woman alone to an address she has not seen (§2.1, SEC-19–21).  Those
 * constraints are enforced by the system, not rendered as preferences on a
 * profile, and declines made under them are excluded from her public
 * confirmation-rate statistic.
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { EMPTY_JSON_ARRAY, nowIso } from '../../../shared/db-values';
import { boolCol, createdAt, jsonCol, pk, timestampCol } from './_common';

import { RATE_TYPES, TEACHING_MODES } from '../../../shared/rates';
import { users } from './identity';
import { areas, boards, cities, levels, subjects } from './reference';

/**
 * Tutor gender is `female` or `male` only, and is required (FR-16.1).
 *
 * The wider `GENDERS` union used on `users` is not reused here on purpose.
 * Gender preference is a **hard exclusion** (FR-16.3, CLAUDE.md §2.4): a family
 * requiring a female tutor must receive a result set from which every other
 * tutor is absent. A third or undeclared value has no defensible behaviour
 * under that rule — including such a tutor would break the family's constraint,
 * and excluding them silently would be worse. The honest position is that this
 * field is binary and mandatory, and that a tutor who will not declare it
 * cannot be matched by this platform.
 */
export const TUTOR_GENDERS = ['female', 'male'] as const;
export type TutorGender = (typeof TUTOR_GENDERS)[number];

/** §6.6 status machine, FR-6.1.  Only `approved` is searchable (FR-6.3). */
/**
 * §6.6 status machine, FR-6.1.  **Only `approved` is searchable** (FR-6.3).
 *
 * The specification names the second state "pending"; it is spelled
 * `pending_verification` here because "pending" alone says nothing about what
 * is pending, and this column is read in queries whose correctness is a safety
 * property. Same state, unambiguous name.
 *
 * A tutor moves `draft → pending_verification` themselves, by submitting.
 * Every transition after that belongs to an administrator (§6.6, decision 17):
 * **no tutor-facing endpoint may write `approved`.**
 */
export const PROFILE_STATUSES = [
  'draft',
  'pending_verification',
  'documents_submitted',
  'under_review',
  'approved',
  'rejected',
  'more_info_needed',
] as const;

/** The one status search may return (FR-6.3). Exported so no query hard-codes it. */
export const SEARCHABLE_PROFILE_STATUS = 'approved' as const;

/** Statuses a tutor may put their own profile into. `approved` is absent. */
export const TUTOR_SETTABLE_PROFILE_STATUSES = ['draft', 'pending_verification'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const tutorProfiles = sqliteTable(
  'tutor_profiles',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    gender: text('gender', { enum: TUTOR_GENDERS }).notNull(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    /** Free text, any script.  Stored unchanged, never translated (§2.10). */
    bio: text('bio'),
    bioUr: text('bio_ur'),
    qualifications: text('qualifications'),
    experienceYears: integer('experience_years').notNull().default(0),
    teachesAtHome: boolCol('teaches_at_home').notNull().default(0),
    teachesOnline: boolCol('teaches_online').notNull().default(0),
    teachesAtOwnPlace: boolCol('teaches_at_own_place')
      .notNull().default(0),
    /** JSON array of area ids the tutor will travel to (FR-2.7, FR-29.12). */
    willingAreasJson: jsonCol('willing_areas_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /**
     * A volunteer teaches without a fee.  The flag **never** substitutes for
     * verification — a volunteer is checked against CNIC and academic documents
     * on exactly the same basis as a paid tutor (FR-33.10).
     */
    volunteerFlag: boolCol('volunteer_flag').notNull().default(0),
    /**
     * Hours a week a volunteer declared they can give (FR-33.11).
     *
     * Enforced at booking, not displayed as a preference: a volunteer who is
     * over-committed stops turning up, and the family that loses those sessions
     * is the one that could not pay for them in the first place.
     */
    volunteerWeeklyHours: integer('volunteer_weekly_hours'),
    profileStatus: text('profile_status', { enum: PROFILE_STATUSES }).notNull().default('draft'),
    /** Public URL segment for the shareable profile (§6.21). */
    slug: text('slug').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_tutor_profiles_user').on(t.userId),
    uniqueIndex('idx_tutor_profiles_slug').on(t.slug),
    // The hard-filter path: status first (only approved tutors are searchable),
    // then gender, then city. Search must not compute anything (NFR-1).
    index('idx_tutor_profiles_search').on(t.profileStatus, t.gender, t.cityId),
  ],
);

/**
 * Claim lifecycle.
 *
 * `asserted` means claimed and nothing more.  Only `verified` may be presented
 * to a family as competence, and only with the badge wording FR-6.8 permits.
 * `expired` exists because a competency badge lapses at twelve months (§6.28).
 */
export const CLAIM_STATUSES = [
  'asserted',
  'under_assessment',
  'verified',
  'failed',
  'expired',
  'appealed',
] as const;

/**
 * The only status a tutor-facing endpoint may write.
 *
 * `verified` is set by Agent 2 after an assessment, never by the tutor who made
 * the claim and never by the endpoint that records it (§2.2, §6.11). A claim is
 * an assertion until something tests it.
 */
export const TUTOR_SETTABLE_CLAIM_STATUS = 'asserted' as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const tutorSubjectClaims = sqliteTable(
  'tutor_subject_claims',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    /** Board is part of the claim, not a detail of it (decision 5). */
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    /** JSON array of topic ids within the (subject, level, board) triple. */
    topicIdsJson: jsonCol('topic_ids_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    claimStatus: text('claim_status', { enum: CLAIM_STATUSES }).notNull().default('asserted'),
    /** Set when a competency assessment passed. ISO-8601 UTC text. */
    verifiedAt: timestampCol('verified_at'),
    /** ISO `YYYY-MM-DD`. Twelve months after issue (FR-28.1). */
    expiresOn: text('expires_on'),
    /** 0-100 from the FR-11.5 rubric. Never shown as a public figure. */
    verifiedScore: real('verified_score'),
    /** Appealable once (FR-28.3). Incremented when an appeal is filed. */
    appealCount: integer('appeal_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_claims_tutor').on(t.tutorId),
    index('idx_claims_curriculum').on(t.subjectId, t.levelId, t.boardId, t.claimStatus),
  ],
);

/**
 * Pricing (§6.5).  Monthly-primary, because that is how this market actually
 * contracts (decision 3).
 *
 * `normalisedHourlyAmount` is computed on write by
 * `shared/rates.ts#normaliseHourlyAmount` and stored, so that search sorting
 * and rate benchmarking read an indexed integer instead of computing per
 * request (NFR-1, NFR-15).  Nothing else may write this column.
 *
 * `subjectId` and `levelId` are nullable: a tutor may hold one blanket rate,
 * or a rate per subject and level.  A more specific row wins at read time.
 */
export const tutorRates = sqliteTable(
  'tutor_rates',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id').references(() => subjects.id),
    levelId: text('level_id').references(() => levels.id),
    rateType: text('rate_type', { enum: RATE_TYPES }).notNull(),
    /** Paisa. For `group_monthly`, the tutor's total across the group. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('PKR'),
    sessionsPerWeek: integer('sessions_per_week'),
    minutesPerSession: integer('minutes_per_session'),
    mode: text('mode', { enum: TEACHING_MODES }).notNull(),
    groupSizeMax: integer('group_size_max'),
    /** Paisa, per student per month.  Set only for `group_monthly`. */
    perHeadAmount: integer('per_head_amount'),
    negotiable: boolCol('negotiable').notNull().default(0),
    /**
     * Paisa.  Recorded as a separate line (FR-31.2) and deliberately excluded
     * from normalisation — it varies by the family's area, not by the tuition.
     */
    travelCharge: integer('travel_charge').notNull().default(0),
    /** Paisa per hour, per student.  Written by application code only. */
    normalisedHourlyAmount: integer('normalised_hourly_amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_rates_tutor').on(t.tutorId),
    // Rate-band filtering and benchmarking read this ordering directly.
    index('idx_rates_normalised').on(t.subjectId, t.levelId, t.normalisedHourlyAmount),
  ],
);

export const DOC_TYPES = ['cnic_front', 'cnic_back', 'degree', 'transcript', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Verification documents (SEC-7, NFR-9, FR-33.4).
 *
 * `storagePath` is an object key inside the **private** Supabase Storage
 * bucket — for example `tutors/<tutorId>/cnic-front.jpg`.  It is never a public
 * URL, never a path inside this repository, and never a local filesystem path.
 * Files are served to administrators only, through short-lived signed URLs, and
 * every access is logged.  `assertPrivateStoragePath` in
 * `shared/storage-path.ts` enforces the shape on write.
 *
 * A CNIC *number* is not stored here, or anywhere, in a readable column
 * (SEC-8, NFR-10) — a salted hash for duplicate detection lands with the
 * verification module (§6.6, §6.28).
 */
export const tutorDocuments = sqliteTable(
  'tutor_documents',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    docType: text('doc_type', { enum: DOC_TYPES }).notNull(),
    storagePath: text('storage_path').notNull(),
    uploadedAt: timestampCol('uploaded_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [index('idx_documents_tutor').on(t.tutorId, t.docType)],
);

/**
 * Weekly recurring availability (FR-8.1).
 *
 * `weekday` is 0 (Sunday) to 6 (Saturday).  Times are `HH:MM` text in local
 * Pakistan time — deliberately text, never compared with a database time
 * function, so the comparison behaves identically in SQLite and Postgres
 * (CLAUDE.md §2.1).  Lexicographic ordering of zero-padded `HH:MM` is the same
 * as chronological ordering, which is the property the booking query relies on.
 */
export const tutorAvailability = sqliteTable(
  'tutor_availability',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    mode: text('mode', { enum: TEACHING_MODES }).notNull(),
    /** Set when this slot is offered only in a particular area. */
    areaId: text('area_id').references(() => areas.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_availability_tutor').on(t.tutorId, t.weekday),
    index('idx_availability_area').on(t.areaId),
  ],
);

/**
 * Reciprocal tutor-side safety controls (§6.29.2, SEC-19–21, OBJ-12).
 *
 * These are **enforced by the system**, not displayed as preferences.  A tutor
 * who restricts herself to female students does not appear in a search for a
 * male student — the same hard-exclusion discipline the family's gender filter
 * gets (CLAUDE.md §2.4), applied in the other direction.
 *
 * A decline made under one of these constraints is excluded from her
 * confirmation-rate statistic (SEC-21, FR-29.14), so that holding to her own
 * conditions costs her nothing publicly.
 */
export const tutorSafetyConstraints = sqliteTable(
  'tutor_safety_constraints',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .unique()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    femaleStudentsOnly: boolCol('female_students_only')
      .notNull().default(0),
    guardianPresenceRequired: boolCol('guardian_presence_required')
      .notNull().default(0),
    /** JSON array of area ids this tutor will not travel to. */
    restrictedAreaIdsJson: jsonCol('restricted_area_ids_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    updatedAt: timestampCol('updated_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [uniqueIndex('idx_safety_tutor').on(t.tutorId)],
);

export type TutorProfile = typeof tutorProfiles.$inferSelect;
export type NewTutorProfile = typeof tutorProfiles.$inferInsert;
export type TutorSubjectClaim = typeof tutorSubjectClaims.$inferSelect;
export type TutorRate = typeof tutorRates.$inferSelect;
export type NewTutorRate = typeof tutorRates.$inferInsert;
export type TutorDocument = typeof tutorDocuments.$inferSelect;
export type TutorAvailability = typeof tutorAvailability.$inferSelect;
export type TutorSafetyConstraints = typeof tutorSafetyConstraints.$inferSelect;
