/**
 * Organisations, moderation and the audit log — specification §9.9, §6.13, §6.14.
 *
 * The load-bearing table here is `admin_actions`.  Everything the specification
 * claims about verification — that it is platform-owned, attributed, and
 * timestamped (§6.6, decision 17) — rests on that log being append-only.  A
 * chain of custody that can be edited is not a chain of custody.
 */

import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { createdAt, jsonCol, paisa, pk, timestampCol } from './_common';

import { FLAG_STATUSES, FLAG_TARGET_TYPES } from '../../../shared/moderation';
import {
  ORG_TYPES,
  VACANCY_INTEREST_STATUSES,
  VACANCY_STATUSES,
} from '../../../shared/organisations';
import { TEACHING_MODES, RATE_TYPES } from '../../../shared/rates';
import { users } from './identity';
import { areas, boards, cities, levels, subjects } from './reference';
import { tutorProfiles } from './tutor';

/**
 * The vocabularies below are owned by `/shared` and re-exported here, so the
 * column enum and the Zod schema that validates the request body cannot drift
 * apart. They had: `shared/moderation.ts` accepted a `message` flag target the
 * column had never heard of, for an entity §4.2 puts permanently out of scope.
 */
export { FLAG_STATUSES, FLAG_TARGET_TYPES, ORG_TYPES, VACANCY_INTEREST_STATUSES, VACANCY_STATUSES };
export type { FlagStatus, FlagTargetType } from '../../../shared/moderation';
export type {
  OrgType,
  VacancyInterestStatus,
  VacancyStatus,
} from '../../../shared/organisations';

/** Organisations follow the same administrator approval workflow (FR-6.11). */
export const orgProfiles = sqliteTable(
  'org_profiles',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgName: text('org_name').notNull(),
    orgType: text('org_type', { enum: ORG_TYPES }).notNull(),
    description: text('description'),
    website: text('website'),

    /**
     * Location — FR-13.1.  Area is the finest granularity in this project
     * (§4.2): no street, no coordinates.  An academy is a business premises
     * rather than a home, but the taxonomy is the same one search uses, and
     * having two location vocabularies would mean two of everything.
     */
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    areaId: text('area_id').references(() => areas.id),

    /**
     * Business contact — FR-13.1.
     *
     * Deliberately separate from the owning account's login email and personal
     * phone. An organisation profile is publicly visible once approved, and
     * publishing the credentials-bearing address of the person who registered
     * it is a different act from publishing the academy's front desk.
     */
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),

    approvedAt: timestampCol('approved_at'),
    /** The administrator who approved.  Attribution, as for tutors (FR-6.6). */
    approvedBy: text('approved_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_org_profiles_user').on(t.userId),
    // Administrator approval queue: unapproved organisations.
    index('idx_org_profiles_approval').on(t.approvedAt, t.createdAt),
  ],
);

export const vacancies = sqliteTable(
  'vacancies',
  {
    id: pk(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgProfiles.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    boardId: text('board_id').references(() => boards.id),
    mode: text('mode', { enum: TEACHING_MODES }).notNull(),
    /** Paisa. */
    rateOffered: paisa('rate_offered'),
    rateType: text('rate_type', { enum: RATE_TYPES }),
    areaId: text('area_id').references(() => areas.id),
    description: text('description'),
    status: text('status', { enum: VACANCY_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_vacancies_org').on(t.orgId, t.status),
    // Public browsable board (FR-13.6) and tutor-facing filtering.
    index('idx_vacancies_browse').on(t.status, t.subjectId, t.levelId, t.areaId),
  ],
);

/**
 * Interest expressed in one action, with no cover letter (FR-13.4).
 *
 * Only `expressed` is ever written. The remaining three are FR-13.5's
 * applicant-tracking states, which decision 4 removed — see the header of
 * `shared/organisations.ts`.
 */
export const vacancyInterests = sqliteTable(
  'vacancy_interests',
  {
    id: pk(),
    vacancyId: text('vacancy_id')
      .notNull()
      .references(() => vacancies.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    status: text('status', { enum: VACANCY_INTEREST_STATUSES }).notNull().default('expressed'),
    createdAt: createdAt(),
  },
  (t) => [
    // One expression of interest per tutor per vacancy.
    uniqueIndex('idx_vacancy_interests_unique').on(t.vacancyId, t.tutorId),
    index('idx_vacancy_interests_vacancy').on(t.vacancyId, t.status),
    index('idx_vacancy_interests_tutor').on(t.tutorId),
  ],
);

/**
 * Flags exist on tutor profiles, reviews and vacancies (FR-14.1) — and on
 * requesting families as well as tutors (SEC-10).
 *
 * The vocabulary is re-exported from `shared/moderation.ts` rather than declared
 * here, so the column enum and the Zod schema that validates the request body
 * cannot drift apart. They did: `shared` accepted a `message` target the column
 * had never heard of, for an entity §4.2 puts permanently out of scope.
 */
export const flags = sqliteTable(
  'flags',
  {
    id: pk(),
    targetType: text('target_type', { enum: FLAG_TARGET_TYPES }).notNull(),
    /** Polymorphic id.  Not a foreign key — the target table varies. */
    targetId: text('target_id').notNull(),
    reporterUserId: text('reporter_user_id').references(() => users.id),
    reason: text('reason').notNull(),
    detail: text('detail'),
    status: text('status', { enum: FLAG_STATUSES }).notNull().default('open'),
    resolvedBy: text('resolved_by').references(() => users.id),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestampCol('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // The administrator flag queue (FR-14.2): open flags, oldest first.
    index('idx_flags_queue').on(t.status, t.createdAt),
    // "Has this profile been flagged before?"
    index('idx_flags_target').on(t.targetType, t.targetId),
    index('idx_flags_reporter').on(t.reporterUserId),
  ],
);

/**
 * The immutable audit log — §9.9, FR-14.4, SEC-13, NFR-19.
 *
 * **APPEND-ONLY.  No application path issues an `UPDATE` or a `DELETE` against
 * this table** — not for corrections, not for cleanup, not in a migration, not
 * in a test helper, not in an administrator tool.  A mistake is corrected by
 * appending a corrective entry.
 *
 * The only permitted writer is `appendAdminAction` in
 * `server/services/audit.ts`, which exposes no update or delete operation at
 * all.  If you find yourself needing one, the answer is a new row.
 *
 * Every administrator decision that affects a person writes here: verification
 * approval and rejection, appeal override, dispute resolution, flag resolution,
 * feedback triage, taxonomy edits.  This is what makes the verification chain
 * of custody in §6.6 meaningful rather than decorative.
 */
export const adminActions = sqliteTable(
  'admin_actions',
  {
    id: pk(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id),
    /** e.g. `tutor.identity_approved`, `payment_dispute.resolved`. */
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /**
     * Structured context: which artefacts were checked (FR-6.5), the written
     * reason for a rejection (FR-6.7), the reasoning for a dispute resolution
     * (FR-31.7).  Must never contain a CNIC number, a token, a password or a
     * full residential address (CLAUDE.md §2.2).
     */
    detailJson: jsonCol('detail_json'),
    createdAt: createdAt(),
  },
  (t) => [
    // "What did this administrator do?"
    index('idx_admin_actions_actor').on(t.adminUserId, t.createdAt),
    // "What was done to this tutor?" — the chain of custody read.
    index('idx_admin_actions_target').on(t.targetType, t.targetId, t.createdAt),
    index('idx_admin_actions_action').on(t.action, t.createdAt),
  ],
);

export type OrgProfile = typeof orgProfiles.$inferSelect;
export type Vacancy = typeof vacancies.$inferSelect;
export type VacancyInterest = typeof vacancyInterests.$inferSelect;
export type Flag = typeof flags.$inferSelect;
export type AdminAction = typeof adminActions.$inferSelect;
export type NewAdminAction = typeof adminActions.$inferInsert;
