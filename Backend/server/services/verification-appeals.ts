/**
 * Appeals and administrator override — §6.28, SEC-18, decision 12.
 *
 * > *An automated verdict affecting a person's livelihood is never final
 * > without a route to human review.*
 *
 * The platform withholds a badge that determines whether someone can earn, on
 * the basis of an assessment a language model produced. FR-28.3 and FR-28.6
 * matter disproportionately for that reason, and the specification says so in
 * its own rationale: an unappealable machine verdict on a person's professional
 * competence would be indefensible.
 *
 * The rules, exactly as §6.28 states them:
 *
 *  · **Once.** One appeal per decision (FR-28.3), enforced by a unique index on
 *    `against_record_id` as well as by the check here.
 *  · **After seven days.** A cooling period, so an appeal is a considered act
 *    rather than a reflex (FR-28.3).
 *  · **The prior attempt is retained and never overwritten** (FR-28.4). An
 *    override appends a new record that supersedes the old one; the old row is
 *    not touched.
 *  · **Every outcome is logged with actor, timestamp and reasoning** (FR-28.5),
 *    into the append-only log.
 */

import { and, eq } from 'drizzle-orm';

import type { VerifiableArtefact } from '../../shared/badges';
import { newId, nowIso, toDbTimestamp } from '../../shared/db-values';
import type { Executor } from '../repositories/_base';
import {
  APPEAL_COOLING_DAYS,
  notifications,
  verificationAppeals,
  verificationRecords,
} from '../db/schema/verification';
import type { VerificationAppeal } from '../db/schema/verification';
import { SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import { getTutorProfileOrThrow, updateTutorProfileFields } from '../repositories/tutors';
import { appendAdminAction } from './audit';
import { VerificationError, addDays } from './verification';

/** The earliest an appeal against this decision may be filed (FR-28.3). */
export function appealEligibleFrom(decidedAt: Date): Date {
  return addDays(decidedAt, APPEAL_COOLING_DAYS);
}

export interface FileAppealResult {
  appealId: string;
  eligibleFrom: string;
}

/**
 * A tutor appeals a rejection or a failed competency verdict.
 *
 * Refuses for three reasons, each with its own code so the interface can say
 * something useful: the decision is not appealable, the cooling period has not
 * elapsed, or this decision has already been appealed.
 */
export async function fileAppeal(
  db: Executor,
  input: {
    tutorId: string;
    againstRecordId: string;
    tutorReason: string;
    at?: Date;
  },
): Promise<FileAppealResult> {
  const at = input.at ?? new Date();

  const rows = await db
    .select()
    .from(verificationRecords)
    .where(eq(verificationRecords.id, input.againstRecordId))
    .limit(1);
  const record = rows[0];

  if (!record || record.tutorId !== input.tutorId) {
    throw new VerificationError(404, 'record_not_found', 'No such verification decision.');
  }

  // An approval is not appealable, and neither is an expiry — a lapsed badge is
  // renewed by re-assessment, not argued with (FR-28.1, FR-28.2).
  if (record.decision !== 'rejected' && record.decision !== 'more_info_needed') {
    throw new VerificationError(
      409,
      'not_appealable',
      `A decision of "${record.decision}" is not appealable. ` +
        'An expired badge is renewed by taking the assessment again.',
    );
  }

  const eligibleFrom = appealEligibleFrom(new Date(record.decidedAt));
  if (at.getTime() < eligibleFrom.getTime()) {
    throw new VerificationError(
      409,
      'cooling_period',
      `An appeal may be filed from ${eligibleFrom.toISOString().slice(0, 10)}, ` +
        `${APPEAL_COOLING_DAYS} days after the decision.`,
    );
  }

  const existing = await db
    .select()
    .from(verificationAppeals)
    .where(eq(verificationAppeals.againstRecordId, input.againstRecordId))
    .limit(1);

  if (existing[0]) {
    throw new VerificationError(
      409,
      'already_appealed',
      'This decision has already been appealed. An appeal may be filed once (FR-28.3).',
    );
  }

  const appealId = newId();
  await db.insert(verificationAppeals).values({
    id: appealId,
    tutorId: input.tutorId,
    track: record.track,
    againstRecordId: input.againstRecordId,
    claimId: record.claimId,
    tutorReason: input.tutorReason,
    eligibleFrom: eligibleFrom.toISOString(),
    status: 'open',
    createdAt: nowIso(),
  });

  return { appealId, eligibleFrom: eligibleFrom.toISOString().slice(0, 10) };
}

export interface AppealDecisionResult {
  appealId: string;
  outcome: 'upheld' | 'dismissed';
  /** Present when upholding overturned the original decision. */
  supersedingRecordId: string | null;
  searchable: boolean;
}

/**
 * An administrator rules on an appeal — FR-28.6.
 *
 * **Upholding does not edit the original decision.** It appends a new
 * `verification_records` row carrying `supersedesId`, so the history reads:
 * rejected on this date for this reason, overridden on that date for that
 * reason, by this person. Both are permanent. That is the difference between a
 * record and a status field, and it is the whole reason the appeal path is
 * worth anything.
 */
export async function decideAppeal(
  db: Executor,
  input: {
    appealId: string;
    adminUserId: string;
    outcome: 'uphold' | 'dismiss';
    reason: string;
    artefactsChecked?: readonly VerifiableArtefact[];
    at?: Date;
  },
): Promise<AppealDecisionResult> {
  const at = input.at ?? new Date();

  const rows = await db
    .select()
    .from(verificationAppeals)
    .where(and(eq(verificationAppeals.id, input.appealId), eq(verificationAppeals.status, 'open')))
    .limit(1);
  const appeal = rows[0];

  if (!appeal) {
    throw new VerificationError(404, 'appeal_not_found', 'No such open appeal.');
  }

  const profile = await getTutorProfileOrThrow(db, appeal.tutorId);
  const upheld = input.outcome === 'uphold';
  let supersedingRecordId: string | null = null;
  let searchable = profile.profileStatus === SEARCHABLE_PROFILE_STATUS;

  if (upheld) {
    supersedingRecordId = newId();
    await db.insert(verificationRecords).values({
      id: supersedingRecordId,
      tutorId: appeal.tutorId,
      track: appeal.track,
      decision: 'overridden',
      artefactsCheckedJson: JSON.stringify([...(input.artefactsChecked ?? [])]),
      decidedBy: input.adminUserId,
      decidedAt: at.toISOString(),
      reason: input.reason,
      claimId: appeal.claimId,
      // The original row is referenced, never modified (FR-28.4).
      supersedesId: appeal.againstRecordId,
      createdAt: nowIso(),
    });

    if (appeal.track === 'identity') {
      await updateTutorProfileFields(db, appeal.tutorId, { profileStatus: SEARCHABLE_PROFILE_STATUS });
      searchable = true;
    }
  }

  await db
    .update(verificationAppeals)
    .set({
      status: upheld ? 'upheld' : 'dismissed',
      decidedBy: input.adminUserId,
      decisionReason: input.reason,
      decidedAt: toDbTimestamp(at),
    })
    .where(eq(verificationAppeals.id, input.appealId));

  // FR-28.5: actor, timestamp, reasoning — permanently.
  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: upheld ? 'verification.appeal_upheld' : 'verification.appeal_dismissed',
    targetType: 'tutor_profile',
    targetId: appeal.tutorId,
    detailJson: {
      appealId: appeal.id,
      track: appeal.track,
      againstRecordId: appeal.againstRecordId,
      supersedingRecordId,
      reason: input.reason,
      overrodeAutomatedVerdict: appeal.track === 'competency',
    },
  });

  await db.insert(notifications).values({
    id: newId(),
    userId: profile.userId,
    kind: 'appeal_decided',
    title: upheld ? 'Your appeal was upheld' : 'Your appeal was not upheld',
    body: input.reason,
    linkPath: '/tutor/verification',
    createdAt: nowIso(),
  });

  return {
    appealId: appeal.id,
    outcome: upheld ? 'upheld' : 'dismissed',
    supersedingRecordId,
    searchable,
  };
}

/** The administrator appeal queue (FR-28.6), oldest first. */
export async function listOpenAppeals(db: Executor): Promise<VerificationAppeal[]> {
  return db
    .select()
    .from(verificationAppeals)
    .where(eq(verificationAppeals.status, 'open'))
    .orderBy(verificationAppeals.createdAt);
}
