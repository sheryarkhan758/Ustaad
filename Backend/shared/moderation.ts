/**
 * Moderation and administration contracts — §6.14.
 *
 * This module owns the flag vocabulary. `server/db/schema/admin.ts` imports
 * `FLAG_TARGET_TYPES` and `FLAG_STATUSES` from here rather than declaring its
 * own copy: two lists that must agree and are written in two places eventually
 * disagree, and the way that failure surfaced was a Zod schema accepting a
 * `targetType` the column had never heard of.
 */

import { z } from 'zod';

/**
 * What may be reported — FR-14.1 and SEC-10.
 *
 * FR-14.1 names tutor profiles, reviews and vacancies. SEC-10 widens it to *all*
 * user-generated content and to **requesting families as well as tutors**, which
 * is what `user` and `booking` are for: on a platform that sends a woman alone to
 * a stranger's house, a reporting route that only points at tutors is half a
 * control.
 *
 * There is deliberately no `message` target. §4.2 puts in-app chat permanently
 * out of scope and §2.3 forbids any private tutor-to-minor channel, so no message
 * entity exists to flag. A target type for a table that cannot exist would be an
 * invitation to build the table.
 */
export const FLAG_TARGET_TYPES = [
  'tutor_profile',
  'review',
  'vacancy',
  'user',
  'booking',
] as const;
export type FlagTargetType = (typeof FLAG_TARGET_TYPES)[number];

export const FLAG_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

/** Statuses that still need an administrator. */
export const OPEN_FLAG_STATUSES = ['open', 'reviewing'] as const satisfies readonly FlagStatus[];

export function isOpenFlagStatus(status: string): boolean {
  return (OPEN_FLAG_STATUSES as readonly string[]).includes(status);
}

/**
 * A report. `reason` is a short label, `detail` the reporter's own words —
 * any script, stored unchanged and never translated (§2.10).
 */
export const createFlagSchema = z.object({
  targetType: z.enum(FLAG_TARGET_TYPES),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(200),
  detail: z.string().trim().max(2000).optional().nullable(),
});

export type CreateFlagInput = z.infer<typeof createFlagSchema>;

/**
 * Resolution requires a written reason, because the resolution is audited and an
 * audit entry reading "dismissed" explains nothing to the next administrator, or
 * to the person who reported.
 */
export const resolveFlagSchema = z.object({
  decision: z.enum(['actioned', 'dismissed']),
  reason: z.string().trim().min(15).max(2000),
});

export type ResolveFlagInput = z.infer<typeof resolveFlagSchema>;

/* -------------------------------------------------------------------------
 * The administrator dashboard — FR-14.3
 * ---------------------------------------------------------------------- */

/**
 * Every count FR-14.3 names, plus the four the build has since added.
 *
 * FR-14.3 asks for "pending approvals, documents awaiting review, open flags,
 * safety-concern reviews, open verification appeals, expiring badges, open
 * payment disputes, and totals by role". `pendingVerifications` and
 * `documentsAwaitingReview` are separate fields because the requirement lists
 * them separately and they need different administrator work: one needs a
 * decision, the other needs someone to open a document.
 *
 * Everything here is a **count**. No row, no id, no name crosses this boundary —
 * which is what lets an administrator-only dashboard read the unapproved-profile
 * table without becoming a second public listing surface (§2.4).
 */
export const adminDashboardCountsSchema = z.object({
  /** Tutor profiles submitted for identity verification and awaiting a decision. */
  pendingVerifications: z.number().int().nonnegative(),
  /** Profiles whose documents have been uploaded but not yet opened (FR-14.3). */
  documentsAwaitingReview: z.number().int().nonnegative(),
  /** Organisations awaiting the same administrator approval as a tutor (FR-6.11). */
  pendingOrganisations: z.number().int().nonnegative(),
  openFlags: z.number().int().nonnegative(),
  /**
   * Reviews an analysis flagged as a safety concern and on which no
   * administrator has yet acted (FR-9.8, SEC-9). Never public, never disclosed
   * to the tutor.
   */
  safetyConcernReviews: z.number().int().nonnegative(),
  /** Appeals awaiting human override (FR-28.6, SEC-18). */
  openVerificationAppeals: z.number().int().nonnegative(),
  /** Competency badges lapsing inside the warning window (FR-28.1, FR-28.2). */
  expiringVerifications: z.number().int().nonnegative(),
  openDisputes: z.number().int().nonnegative(),
  newFeedback: z.number().int().nonnegative(),
  newVolunteerApplications: z.number().int().nonnegative(),
  /** Suppression-surviving cohorts on the unmet demand board (SEC-16). */
  unmetDemandGaps: z.number().int().nonnegative(),
  activeEngagements: z.number().int().nonnegative(),
  /** FR-14.3 "totals by role". Counts only — never a user list. */
  usersByRole: z.record(z.string(), z.number().int().nonnegative()),
});

export type AdminDashboardCounts = z.infer<typeof adminDashboardCountsSchema>;
