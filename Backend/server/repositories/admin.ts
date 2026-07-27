/**
 * Administration aggregate — §6.14.
 *
 * Two jobs: the flag and report queue (FR-14.1, FR-14.2), and the counting that
 * feeds the administrator dashboard (FR-14.3).
 *
 * ── Why the counts live in a repository and not in the service ──────────────
 * The dashboard has to count rows in nine tables, one of which is
 * `tutor_profiles`. `search.visibility.test.ts` asserts that exactly one module
 * builds a public query against that table, and the guard is worth keeping
 * sharp, so the read is here — in the layer that is allowed to build queries —
 * behind a function whose return type is a number.
 *
 * **Nothing in this file returns a tutor profile row.** `countTutorProfilesIn`
 * takes statuses and gives back an integer; there is no overload that hands
 * back the rows it counted. A dashboard that leaked profile rows would be a
 * listing surface that skipped the gender filter and the searchable-status gate,
 * which is precisely the failure the visibility guard exists to prevent.
 *
 * ── Why `.length` and not `count(*)` ───────────────────────────────────────
 * The one raw `count(*)` fragment in this codebase is confined to
 * `server/db/queries/count-rows.ts` and is documented there as never being
 * reachable from a request handler. Rather than widen that exemption, these
 * counts select a single narrow column and take the array length. The dashboard
 * is administrator-only, is not on the NFR-1 search path, and runs against
 * tables whose row counts are bounded by the size of an administrator's actual
 * workload.
 */

import { and, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';

import { fromDbTimestamp, newId, nowIso } from '../../shared/db-values';
import {
  type CreateFlagInput,
  type FlagStatus,
  type FlagTargetType,
  OPEN_FLAG_STATUSES,
  isOpenFlagStatus,
} from '../../shared/moderation';
import { adminActions, flags, orgProfiles } from '../db/schema/admin';
import { bookings } from '../db/schema/booking';
import { users, type UserRole } from '../db/schema/identity';
import { paymentDisputes } from '../db/schema/payment';
import { platformFeedback, volunteerApplications } from '../db/schema/platform';
import { reviewAnalyses } from '../db/schema/feedback';
import { type ProfileStatus, tutorProfiles, tutorSubjectClaims } from '../db/schema/tutor';
import { verificationAppeals } from '../db/schema/verification';
import { type Executor, NotFoundError } from './_base';

/* -------------------------------------------------------------------------
 * The flag and report queue — FR-14.1, FR-14.2
 * ---------------------------------------------------------------------- */

export interface FlagRecord {
  id: string;
  targetType: FlagTargetType;
  targetId: string;
  /**
   * NULL when the reporter was not logged in. Never shown to the target of the
   * report — `docs/DATA_MODEL.md` records `flags` as administrator-only for
   * exactly this reason.
   */
  reporterUserId: string | null;
  reason: string;
  detail: string | null;
  status: FlagStatus;
  resolvedBy: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

type StoredFlag = typeof flags.$inferSelect;

function toFlag(row: StoredFlag): FlagRecord {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    reporterUserId: row.reporterUserId,
    reason: row.reason,
    detail: row.detail,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    resolvedAt: fromDbTimestamp(row.resolvedAt),
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function insertFlag(
  db: Executor,
  input: CreateFlagInput & { reporterUserId: string | null },
): Promise<FlagRecord> {
  const id = newId();
  await db.insert(flags).values({
    id,
    targetType: input.targetType,
    targetId: input.targetId,
    reporterUserId: input.reporterUserId,
    reason: input.reason,
    detail: input.detail ?? null,
    status: 'open',
    createdAt: nowIso(),
  });
  return getFlagOrThrow(db, id);
}

export async function findFlag(db: Executor, id: string): Promise<FlagRecord | null> {
  const rows = await db.select().from(flags).where(eq(flags.id, id)).limit(1);
  return rows[0] ? toFlag(rows[0]) : null;
}

export async function getFlagOrThrow(db: Executor, id: string): Promise<FlagRecord> {
  const found = await findFlag(db, id);
  if (!found) throw new NotFoundError('flag', id);
  return found;
}

/**
 * The administrator queue — reason, reporter, target and current state
 * (FR-14.2). Oldest first: a report that has waited longest is the one most
 * likely to be about something still happening.
 */
export async function listOpenFlags(db: Executor): Promise<FlagRecord[]> {
  const rows = await db
    .select()
    .from(flags)
    .where(inArray(flags.status, [...OPEN_FLAG_STATUSES]))
    .orderBy(flags.createdAt, flags.id);
  return rows.map(toFlag);
}

/** Every report against one target, newest first. "Has this happened before?" */
export async function listFlagsForTarget(
  db: Executor,
  targetType: FlagTargetType,
  targetId: string,
): Promise<FlagRecord[]> {
  const rows = await db
    .select()
    .from(flags)
    .where(and(eq(flags.targetType, targetType), eq(flags.targetId, targetId)))
    .orderBy(desc(flags.createdAt));
  return rows.map(toFlag);
}

/**
 * Record the resolution. The audit entry is written by the service, not here —
 * a repository that wrote to `admin_actions` behind the caller's back would put
 * two writers on the append-only log (§2.7).
 */
export async function markFlagResolved(
  db: Executor,
  input: { flagId: string; decision: 'actioned' | 'dismissed'; adminUserId: string; reason: string; at: Date },
): Promise<FlagRecord> {
  await db
    .update(flags)
    .set({
      status: input.decision,
      resolvedBy: input.adminUserId,
      resolutionNote: input.reason,
      resolvedAt: input.at.toISOString(),
    })
    .where(eq(flags.id, input.flagId));
  return getFlagOrThrow(db, input.flagId);
}

export { isOpenFlagStatus };

/* -------------------------------------------------------------------------
 * Dashboard counting — FR-14.3
 * ---------------------------------------------------------------------- */

/**
 * How many tutor profiles sit in these statuses.
 *
 * Returns an integer and never the rows. See the module header: this is the one
 * concession the visibility guard makes for the dashboard, and it is kept to a
 * scalar so it cannot grow into a listing.
 */
export async function countTutorProfilesIn(
  db: Executor,
  statuses: readonly ProfileStatus[],
): Promise<number> {
  if (statuses.length === 0) return 0;
  const rows = await db
    .select({ id: tutorProfiles.id })
    .from(tutorProfiles)
    .where(inArray(tutorProfiles.profileStatus, [...statuses]));
  return rows.length;
}

/** Organisations awaiting the same administrator approval as a tutor (FR-6.11). */
export async function countPendingOrganisations(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: orgProfiles.id })
    .from(orgProfiles)
    .where(isNull(orgProfiles.approvedAt));
  return rows.length;
}

export async function countOpenFlags(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: flags.id })
    .from(flags)
    .where(inArray(flags.status, [...OPEN_FLAG_STATUSES]));
  return rows.length;
}

/**
 * Safety-concern reviews still awaiting an administrator (FR-9.8, SEC-9).
 *
 * `review_analyses` has no resolution column — a safety flag is raised by the
 * analysis worker and is never cleared, because clearing it would erase the
 * fact that a concern was raised. So "outstanding" is derived: a flagged review
 * on which no `admin_actions` entry has yet been appended. That keeps the count
 * honest without giving anything a way to unset the flag.
 */
export async function countOutstandingSafetyConcernReviews(db: Executor): Promise<number> {
  const flagged = await db
    .select({ reviewId: reviewAnalyses.reviewId })
    .from(reviewAnalyses)
    .where(eq(reviewAnalyses.safetyConcernFlag, 1));
  if (flagged.length === 0) return 0;

  const acted = await db
    .select({ targetId: adminActions.targetId })
    .from(adminActions)
    .where(eq(adminActions.targetType, 'review'));
  const handled = new Set(acted.map((row) => row.targetId));

  return flagged.filter((row) => !handled.has(row.reviewId)).length;
}

/** Appeals awaiting human override (FR-28.6, SEC-18). */
export async function countOpenVerificationAppeals(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: verificationAppeals.id })
    .from(verificationAppeals)
    .where(eq(verificationAppeals.status, 'open'));
  return rows.length;
}

/**
 * Competency badges lapsing between `from` and `to` inclusive (FR-28.1,
 * FR-28.2). Both bounds are `YYYY-MM-DD` text, which compares correctly in both
 * dialects without a cast because the format is fixed width (§2.1).
 */
export async function countExpiringCompetencyBadges(
  db: Executor,
  from: string,
  to: string,
): Promise<number> {
  const rows = await db
    .select({ id: tutorSubjectClaims.id })
    .from(tutorSubjectClaims)
    .where(
      and(
        eq(tutorSubjectClaims.claimStatus, 'verified'),
        gte(tutorSubjectClaims.expiresOn, from),
        lte(tutorSubjectClaims.expiresOn, to),
      ),
    );
  return rows.length;
}

/**
 * Disputes still needing an administrator — `open` **and** `under_review`.
 *
 * A dispute someone has started investigating is not resolved, and a dashboard
 * that dropped it the moment it was picked up would hide exactly the work most
 * at risk of being forgotten. `resolved` and `withdrawn` are the two states
 * that mean nothing further is owed.
 */
export async function countOpenPaymentDisputes(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: paymentDisputes.id })
    .from(paymentDisputes)
    .where(inArray(paymentDisputes.status, ['open', 'under_review']));
  return rows.length;
}

export async function countNewFeedback(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: platformFeedback.id })
    .from(platformFeedback)
    .where(eq(platformFeedback.status, 'new'));
  return rows.length;
}

export async function countNewVolunteerApplications(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: volunteerApplications.id })
    .from(volunteerApplications)
    .where(eq(volunteerApplications.status, 'received'));
  return rows.length;
}

/** Bookings currently under way — confirmed or in progress. */
export async function countActiveEngagements(db: Executor): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(inArray(bookings.status, ['confirmed', 'in_progress']));
  return rows.length;
}

/**
 * FR-14.3 "totals by role". Counts only.
 *
 * Deactivated accounts are excluded — a dashboard number an administrator uses
 * to judge platform size should not be inflated by people who have left. Every
 * role in `USER_ROLES` is present in the result even at zero, so the interface
 * never has to distinguish "no organisations" from "the key was missing".
 */
export async function countUsersByRole(db: Executor): Promise<Record<UserRole, number>> {
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(ne(users.status, 'deactivated'));

  const totals = { parent: 0, student: 0, tutor: 0, organisation: 0, admin: 0 } as Record<
    UserRole,
    number
  >;
  for (const row of rows) totals[row.role] += 1;
  return totals;
}
