/**
 * Competency badge expiry — FR-28.1, FR-28.2.
 *
 * ── What expires, and what it does not affect ──────────────────────────────
 * §6.28 is about **competency** badges: they lapse twelve months after issue,
 * and the status becomes `expired` **rather than `failed`** (FR-28.1). That
 * distinction is the point of the requirement. A tutor whose badge lapsed did
 * not fail anything; they simply have not been re-assessed, and recording it as
 * a failure would misstate the record on a profile a family reads.
 *
 * **Identity verification is a separate track (FR-6.2) with no stated expiry,
 * and it is identity approval that gates searchability (FR-6.3).** So an
 * expired competency badge leaves the tutor **searchable and unbadged** — the
 * brief's expectation, and §6.28 confirms it. This job therefore never touches
 * `profileStatus`, and a test asserts that.
 *
 * ── The warning ────────────────────────────────────────────────────────────
 * FR-28.2 requires an in-application notice thirty days before expiry, with
 * re-assessment available. The job is idempotent: a dedupe key per
 * (claim, expiry date) means running it twice a day does not send the warning
 * twice.
 */

import { and, eq, isNotNull, lte, ne } from 'drizzle-orm';

import { newId, nowIso } from '../../shared/db-values';
import type { Executor } from '../repositories/_base';
import { tutorProfiles, tutorSubjectClaims } from '../db/schema/tutor';
import {
  EXPIRY_WARNING_DAYS,
  notificationDedupe,
  notifications,
  verificationRecords,
} from '../db/schema/verification';
import { appendAdminAction } from './audit';
import { addDays, isoDate } from './verification';

export interface ExpirySweepResult {
  /** Claims moved to `expired`. */
  expired: string[];
  /** Claims whose tutor was warned that expiry is near. */
  warned: string[];
  /** Claims already expired on a previous run. Reported so a run is legible. */
  alreadyExpired: number;
}

/**
 * The system actor for a job with no human behind it.
 *
 * Every `admin_actions` row needs an actor and the column is not nullable, on
 * purpose: an audit entry that cannot say who acted is not an audit entry. A
 * scheduled job is a real actor, so it is seeded as a real `users` row with the
 * `admin` role and this well-known id, rather than being allowed to write null.
 */
export const SYSTEM_ACTOR_ID = 'system-scheduled-jobs';

async function ensureSystemActor(db: Executor): Promise<string | null> {
  const { users } = await import('../db/schema/identity');
  const rows = await db.select().from(users).where(eq(users.id, SYSTEM_ACTOR_ID)).limit(1);
  return rows[0] ? SYSTEM_ACTOR_ID : null;
}

/**
 * Run the sweep.
 *
 * `now` is a parameter rather than `new Date()` inside, so the job is testable
 * at any point in time and reproducible.
 */
export async function runExpirySweep(
  db: Executor,
  now: Date = new Date(),
): Promise<ExpirySweepResult> {
  const today = isoDate(now);
  const warnFrom = isoDate(addDays(now, EXPIRY_WARNING_DAYS));
  const actorId = await ensureSystemActor(db);

  const result: ExpirySweepResult = { expired: [], warned: [], alreadyExpired: 0 };

  /* --- 1. Lapse anything past its date ---------------------------------- */

  const due = await db
    .select()
    .from(tutorSubjectClaims)
    .where(
      and(
        eq(tutorSubjectClaims.claimStatus, 'verified'),
        isNotNull(tutorSubjectClaims.expiresOn),
        lte(tutorSubjectClaims.expiresOn, today),
      ),
    );

  for (const claim of due) {
    // `expired`, never `failed` (FR-28.1). The tutor did not fail an
    // assessment; the badge simply lapsed.
    await db
      .update(tutorSubjectClaims)
      .set({ claimStatus: 'expired' })
      .where(eq(tutorSubjectClaims.id, claim.id));

    // The badge disappears because `buildBadges` is fed only unexpired verified
    // topics — there is no badge row to delete, which is the safer shape.
    await db.insert(verificationRecords).values({
      id: newId(),
      tutorId: claim.tutorId,
      track: 'competency',
      decision: 'expired',
      artefactsCheckedJson: '[]',
      decidedBy: actorId ?? claim.tutorId,
      decidedAt: now.toISOString(),
      reason:
        `Competency badge lapsed on ${claim.expiresOn}, twelve months after issue (FR-28.1). ` +
        'This is an expiry, not a failed assessment. Re-assessment is available.',
      claimId: claim.id,
      createdAt: nowIso(),
    });

    if (actorId) {
      await appendAdminAction(db, {
        adminUserId: actorId,
        action: 'competency.badge_expired',
        targetType: 'tutor_subject_claim',
        targetId: claim.id,
        detailJson: {
          tutorId: claim.tutorId,
          expiresOn: claim.expiresOn,
          note: 'expired, not failed (FR-28.1)',
        },
      });
    }

    const tutorUserId = await resolveTutorUserId(db, claim.tutorId);
    if (tutorUserId) {
      await db.insert(notifications).values({
        id: newId(),
        userId: tutorUserId,
        kind: 'badge_expired',
        title: 'A competency badge has expired',
        body:
          'Your assessment badge has lapsed twelve months after it was issued. This is not a ' +
          'failed assessment, and your profile is still searchable — the badge is simply no ' +
          'longer shown. You can take the assessment again at any time.',
        linkPath: '/tutor/verification',
        createdAt: nowIso(),
      });
    }

    result.expired.push(claim.id);
  }

  /* --- 2. Warn thirty days ahead (FR-28.2) ------------------------------- */

  const expiringSoon = await db
    .select()
    .from(tutorSubjectClaims)
    .where(
      and(
        eq(tutorSubjectClaims.claimStatus, 'verified'),
        isNotNull(tutorSubjectClaims.expiresOn),
        lte(tutorSubjectClaims.expiresOn, warnFrom),
        ne(tutorSubjectClaims.claimStatus, 'expired'),
      ),
    );

  for (const claim of expiringSoon) {
    if (claim.expiresOn !== null && claim.expiresOn <= today) continue; // handled above

    const dedupeKey = `badge_expiring:${claim.id}:${claim.expiresOn}`;
    const seen = await db
      .select()
      .from(notificationDedupe)
      .where(eq(notificationDedupe.dedupeKey, dedupeKey))
      .limit(1);
    if (seen[0]) continue;

    const tutorUserId = await resolveTutorUserId(db, claim.tutorId);
    if (!tutorUserId) continue;

    await db.insert(notifications).values({
      id: newId(),
      userId: tutorUserId,
      kind: 'badge_expiring',
      title: 'A competency badge expires soon',
      body:
        `Your assessment badge expires on ${claim.expiresOn}. Take the assessment again before ` +
        'then to keep it on your profile. Your profile stays searchable either way.',
      linkPath: '/tutor/verification',
      createdAt: nowIso(),
    });

    await db.insert(notificationDedupe).values({
      id: newId(),
      userId: tutorUserId,
      dedupeKey,
      sentAt: now.toISOString(),
      createdAt: nowIso(),
    });

    result.warned.push(claim.id);
  }

  /* --- 3. Count what was already done, so a run reads honestly ----------- */

  const already = await db
    .select({ id: tutorSubjectClaims.id })
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.claimStatus, 'expired'));
  result.alreadyExpired = already.length - result.expired.length;

  return result;
}

async function resolveTutorUserId(db: Executor, tutorId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: tutorProfiles.userId })
    .from(tutorProfiles)
    .where(eq(tutorProfiles.id, tutorId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * The topics whose badges are currently live, for `buildBadges`.
 *
 * An expired claim is simply not returned, which is how the badge "disappears":
 * there is no badge record to delete and therefore no way for a stale one to
 * survive a partial failure.
 */
export async function listLiveCompetencyTopics(
  db: Executor,
  tutorId: string,
  topicNames: ReadonlyMap<string, string>,
  now: Date = new Date(),
): Promise<{ name: string; expiresOn?: string }[]> {
  const today = isoDate(now);

  const claims = await db
    .select()
    .from(tutorSubjectClaims)
    .where(
      and(eq(tutorSubjectClaims.tutorId, tutorId), eq(tutorSubjectClaims.claimStatus, 'verified')),
    );

  return claims
    .filter((c) => c.expiresOn === null || c.expiresOn > today)
    .flatMap((c) => {
      const ids = JSON.parse(c.topicIdsJson) as string[];
      return ids.map((id) => ({
        name: topicNames.get(id) ?? id,
        ...(c.expiresOn ? { expiresOn: c.expiresOn } : {}),
      }));
    });
}
