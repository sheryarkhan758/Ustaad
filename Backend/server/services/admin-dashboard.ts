/**
 * The administrator dashboard — FR-14.3.
 *
 * "Administrator dashboard with live counts: pending approvals, documents
 * awaiting review, open flags, safety-concern reviews, open verification
 * appeals, expiring badges, open payment disputes, and totals by role."
 *
 * **Live counts, not materialised ones.** This is the one place §2.8's rule
 * genuinely does not apply, and it is worth saying why rather than leaving it to
 * look like an oversight. §2.8 exists to keep the *search* path off aggregate
 * computation, because NFR-1 budgets that path at 500 ms against every tutor on
 * the platform. This is a single administrator, on an authenticated back-office
 * screen, counting their own outstanding work — and a queue depth that is an
 * hour stale is worse than useless, because the number an administrator acts on
 * has to be the number that is true now.
 *
 * Every read goes through `server/repositories/admin.ts` and returns an integer.
 * No row, no id and no name reaches this module, so the dashboard cannot become
 * a listing surface that skipped the searchable-status gate.
 */

import type { AdminDashboardCounts } from '../../shared/moderation';
import { EXPIRY_WARNING_DAYS } from '../db/schema/verification';
import {
  countActiveEngagements,
  countExpiringCompetencyBadges,
  countNewFeedback,
  countNewVolunteerApplications,
  countOpenFlags,
  countOpenPaymentDisputes,
  countOpenVerificationAppeals,
  countOutstandingSafetyConcernReviews,
  countPendingOrganisations,
  countTutorProfilesIn,
  countUsersByRole,
} from '../repositories/admin';
import type { Executor } from '../repositories/_base';
import { readSupplyGaps } from './unmet-demand';

/**
 * Awaiting an administrator's decision.
 *
 * `documents_submitted` is deliberately *not* here — FR-14.3 lists "pending
 * approvals" and "documents awaiting review" as two numbers because they are
 * two different pieces of work. One needs a judgement; the other needs someone
 * to open a file.
 */
const AWAITING_DECISION = ['pending_verification', 'under_review'] as const;
const AWAITING_DOCUMENT_REVIEW = ['documents_submitted'] as const;

/** `YYYY-MM-DD`, the format `expires_on` is stored in. */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export async function getAdminDashboardCounts(
  db: Executor,
  now: Date = new Date(),
): Promise<AdminDashboardCounts> {
  const windowStart = isoDate(now);
  const windowEnd = isoDate(new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000));

  const [
    pendingVerifications,
    documentsAwaitingReview,
    pendingOrganisations,
    openFlags,
    safetyConcernReviews,
    openVerificationAppeals,
    expiringVerifications,
    openDisputes,
    newFeedback,
    newVolunteerApplications,
    activeEngagements,
    usersByRole,
    supply,
  ] = await Promise.all([
    countTutorProfilesIn(db, AWAITING_DECISION),
    countTutorProfilesIn(db, AWAITING_DOCUMENT_REVIEW),
    countPendingOrganisations(db),
    countOpenFlags(db),
    countOutstandingSafetyConcernReviews(db),
    countOpenVerificationAppeals(db),
    countExpiringCompetencyBadges(db, windowStart, windowEnd),
    countOpenPaymentDisputes(db),
    countNewFeedback(db),
    countNewVolunteerApplications(db),
    countActiveEngagements(db),
    countUsersByRole(db),
    // Already suppression-aware: cohorts below three never appear (SEC-16), so
    // the administrator's own dashboard cannot be used to difference the board.
    readSupplyGaps(db),
  ]);

  return {
    pendingVerifications,
    documentsAwaitingReview,
    pendingOrganisations,
    openFlags,
    safetyConcernReviews,
    openVerificationAppeals,
    expiringVerifications,
    openDisputes,
    newFeedback,
    newVolunteerApplications,
    unmetDemandGaps: supply.gaps.length,
    activeEngagements,
    usersByRole,
  };
}
