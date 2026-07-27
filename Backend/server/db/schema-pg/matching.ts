// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/matching.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group matching and unmet demand — specification §9.7, §9.8, §6.23, §6.24.
 *
 * Group matching is **deterministic constraint satisfaction performed in
 * application code, with no AI involvement** (FR-23.7, decision 10).  A family
 * needs to be told why it was grouped with these particular students, and a
 * constraint solver can answer that where a model cannot.
 *
 * Two safety properties carry through this file:
 *
 *  · Participant identities are limited to first name and area until the group
 *    confirms (FR-23.8, SEC-14).  These tables reference `student_profiles`, so
 *    every read path must project, never select the row wholesale.
 *  · Where minors are involved, all group communication stays parent-mediated
 *    (FR-23.9).  That holds automatically — a minor has no account to address.
 */

import { index, integer, primaryKey, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { EMPTY_JSON_ARRAY, nowIso } from '../../../shared/db-values';
import { boolCol, createdAt, jsonCol, paisa, pk, timestampCol } from './_common';

import { studentProfiles } from './identity';
import { areas, boards, levels, subjects } from './reference';
import { tutorProfiles } from './tutor';

/** Family-side gender requirement.  A hard exclusion, never a weight (§2.4). */
export const GENDER_PREFERENCES = ['female_only', 'male_only', 'no_preference'] as const;
export type GenderPreference = (typeof GENDER_PREFERENCES)[number];

/** Partial groups persist seven days, then expire (FR-23.10). */
export const GROUP_REQUEST_STATUSES = [
  'open',
  'proposed',
  'confirmed',
  'expired',
  'withdrawn',
] as const;
export type GroupRequestStatus = (typeof GROUP_REQUEST_STATUSES)[number];

export const groupRequests = pgTable(
  'group_requests',
  {
    id: pk(),
    studentProfileId: text('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    topicsJson: jsonCol('topics_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    /** Willing to be pooled with an adjacent area (FR-23.1, FR-2.9). */
    areaFlex: boolCol('area_flex').notNull().default(0),
    /**
     * Carried into matching as a **hard constraint**: a family requiring a
     * female tutor is never pooled into a group a male tutor would take, and
     * mixed-preference cohorts are not silently reconciled (FR-16.3, FR-23.2).
     */
    genderPreference: text('gender_preference', { enum: GENDER_PREFERENCES })
      .notNull()
      .default('no_preference'),
    maxGroupSize: integer('max_group_size').notNull(),
    /** Paisa, per head per month. */
    budgetMax: paisa('budget_max'),
    availabilityJson: jsonCol('availability_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    status: text('status', { enum: GROUP_REQUEST_STATUSES }).notNull().default('open'),
    expiresAt: timestampCol('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // The matcher's primary sweep: compatible open requests.
    index('idx_group_requests_match').on(
      t.subjectId,
      t.levelId,
      t.boardId,
      t.areaId,
      t.status,
    ),
    // The expiry job.
    index('idx_group_requests_expiry').on(t.status, t.expiresAt),
    index('idx_group_requests_student').on(t.studentProfileId),
  ],
);

/** A tutor accepts or declines a proposed group as a unit (FR-23.5). */
export const GROUP_PROPOSAL_STATUSES = [
  'proposed',
  'accepted',
  'declined',
  'confirmed',
  'expired',
] as const;
export type GroupProposalStatus = (typeof GROUP_PROPOSAL_STATUSES)[number];

export const groupProposals = pgTable(
  'group_proposals',
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
    /** Part of the engagement, not a detail of it (decision 5). */
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    /** JSON array. The intersection of every member's topics, computed in code. */
    topicIdsJson: jsonCol('topic_ids_json')
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** JSON array of `{weekday,startTime,endTime}` — the shared weekly window. */
    availabilityJson: jsonCol('availability_json')
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /**
     * The **strictest** requirement any member stated, computed by
     * `intersectGenderPreference`.  Carried on the proposal so the constraint
     * travels with the group rather than being re-derived, and so a tutor who
     * does not satisfy it can be refused in code rather than by convention
     * (FR-16.3, FR-23.2).
     */
    genderPreference: text('gender_preference', { enum: GENDER_PREFERENCES })
      .notNull()
      .default('no_preference'),
    /**
     * The sorted member request ids, joined.  Two attempts to propose the same
     * set of families to the same tutor are the same proposal, and a stable key
     * is what lets that be recognised rather than duplicated.
     */
    groupKey: text('group_key').notNull(),
    /** Paisa per head per month, at the tutor's group price (FR-23.3). */
    perHeadRate: paisa('per_head_rate').notNull(),
    proposedAt: timestampCol('proposed_at')
      .notNull()
      .$defaultFn(nowIso),
    status: text('status', { enum: GROUP_PROPOSAL_STATUSES }).notNull().default('proposed'),
    /**
     * The tutor accepted the group **as a unit** (FR-23.5).  Separate from
     * `confirmedAt` because the two sides land independently and in either
     * order: a tutor may accept before the last family confirms, or after.
     */
    tutorAcceptedAt: timestampCol('tutor_accepted_at'),
    /**
     * The group exists.  Set only when the tutor has accepted **and** every
     * participant has confirmed (FR-23.4).
     *
     * This single column is the commit point for the whole formation: the
     * member bookings are written first and are not a group until this is set.
     * See `server/services/group-matching.ts` for why that is a transaction's
     * guarantee without a transaction.
     */
    confirmedAt: timestampCol('confirmed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_group_proposals_tutor').on(t.tutorId, t.status),
    index('idx_group_proposals_match').on(t.subjectId, t.levelId, t.areaId, t.status),
    // One live proposal per (tutor, member set).
    uniqueIndex('idx_group_proposals_key').on(t.tutorId, t.groupKey),
  ],
);

/**
 * Membership of a proposed group.
 *
 * A group forms only on explicit confirmation from every participant
 * (FR-23.4): `confirmedAt` null on any row means the group has not formed.
 */
export const groupMembers = pgTable(
  'group_members',
  {
    proposalId: text('proposal_id')
      .notNull()
      .references(() => groupProposals.id, { onDelete: 'cascade' }),
    groupRequestId: text('group_request_id')
      .notNull()
      .references(() => groupRequests.id, { onDelete: 'cascade' }),
    studentProfileId: text('student_profile_id')
      .notNull()
      .references(() => studentProfiles.id),
    /**
     * JSON array of sentences: why this family was grouped with these others
     * (FR-23.7, decision 10).
     *
     * Persisted rather than recomputed, because it is what the family was shown
     * when it decided.  Regenerating it later against a changed adjacency table
     * or a changed threshold would quietly rewrite the reason someone agreed to
     * something.  It names no other family — counts and constraints only
     * (FR-23.8).
     */
    explanationJson: jsonCol('explanation_json')
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** The linked booking created when the group formed (FR-23.6). */
    bookingId: text('booking_id'),
    confirmedAt: timestampCol('confirmed_at'),
    declinedAt: timestampCol('declined_at'),
  },
  (t) => [
    primaryKey({ columns: [t.proposalId, t.groupRequestId] }),
    index('idx_group_members_request').on(t.groupRequestId),
    index('idx_group_members_student').on(t.studentProfileId),
  ],
);

/** Why the search failed (FR-24.1). */
export const UNMET_DEMAND_REASONS = ['no_matches', 'insufficient_information'] as const;
export type UnmetDemandReason = (typeof UNMET_DEMAND_REASONS)[number];

/**
 * Unmet demand — §6.24.
 *
 * **This table deliberately stores no requester identity** (FR-24.2).  There is
 * no `user_id`, no `student_profile_id`, no contact field, and none may be
 * added: the board's whole purpose is to turn discarded failure data into
 * supply intelligence, and it can only do that if a tutor reading "eleven
 * families in this district sought a female Mathematics tutor" cannot resolve
 * that to any one family.
 *
 * Displayed as counts only, suppressed below a cohort of three (FR-24.5,
 * FR-24.6, SEC-16).  The threshold is enforced in the aggregation code, not in
 * the UI.  Aggregation is deterministic; no model is involved (FR-24.7).
 */
export const unmetDemand = pgTable(
  'unmet_demand',
  {
    id: pk(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    topicIdsJson: jsonCol('topic_ids_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    levelId: text('level_id').references(() => levels.id),
    boardId: text('board_id').references(() => boards.id),
    areaId: text('area_id').references(() => areas.id),
    genderPreference: text('gender_preference', { enum: GENDER_PREFERENCES })
      .notNull()
      .default('no_preference'),
    /** Paisa. A band, not the requester's exact stated budget. */
    budgetMax: paisa('budget_max'),
    reason: text('reason', { enum: UNMET_DEMAND_REASONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Tutor-facing aggregate over the trailing thirty days (FR-24.3).
    index('idx_unmet_demand_rollup').on(t.subjectId, t.areaId, t.createdAt),
    // Administrator supply-gap view by area and subject (FR-24.4).
    index('idx_unmet_demand_area').on(t.areaId, t.levelId, t.createdAt),
  ],
);

export type GroupRequest = typeof groupRequests.$inferSelect;
export type GroupProposal = typeof groupProposals.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type UnmetDemand = typeof unmetDemand.$inferSelect;
