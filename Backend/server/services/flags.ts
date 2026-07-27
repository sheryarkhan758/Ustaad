/**
 * The flag and report queue — §6.14, FR-14.1, FR-14.2, SEC-10.
 *
 * A user reports a tutor profile, a review, a vacancy, a booking or another
 * user; an administrator resolves it with a written reason; the resolution is
 * audited.
 *
 * Three properties this module holds on to:
 *
 *  · **The reporter's identity never travels with the resolution.** The audit
 *    entry records that a report was resolved and why; the reporter's user id is
 *    stored on the flag row, which `docs/DATA_MODEL.md` marks administrator-only.
 *    A family that reports a tutor and then finds the tutor knows who reported
 *    will not report again — and on a platform where the thing being reported
 *    may be a safety concern, that is the failure that matters (SEC-26 makes the
 *    same point for platform feedback).
 *  · **A resolution needs words.** `resolveFlagSchema` demands fifteen
 *    characters minimum. An audit trail of the word "dismissed" is a log, not a
 *    record.
 *  · **A flag resolves once.** Re-resolving would append a second audit entry
 *    describing a transition that did not happen.
 */

import type { ResolveFlagInput } from '../../shared/moderation';
import type { CreateFlagInput } from '../../shared/moderation';
import {
  type FlagRecord,
  getFlagOrThrow,
  insertFlag,
  isOpenFlagStatus,
  listFlagsForTarget,
  listOpenFlags,
  markFlagResolved,
} from '../repositories/admin';
import type { Executor } from '../repositories/_base';
import { appendAdminAction } from './audit';

export type { FlagRecord };

/** A deliberate, user-facing refusal. `errorHandler` renders the shape. */
export class FlagError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FlagError';
  }
}

/**
 * Record a report (FR-14.1).
 *
 * Nothing is validated about the target beyond its id: a report against a row
 * that has since been removed is still evidence, and refusing it would let
 * deletion suppress reporting.
 */
export async function createFlag(
  db: Executor,
  input: CreateFlagInput & { reporterUserId: string | null },
): Promise<FlagRecord> {
  return insertFlag(db, input);
}

/** The administrator queue (FR-14.2). */
export async function listFlagQueue(db: Executor): Promise<FlagRecord[]> {
  return listOpenFlags(db);
}

/** The history of reports against one target. Administrators only. */
export async function listFlagHistory(
  db: Executor,
  targetType: FlagRecord['targetType'],
  targetId: string,
): Promise<FlagRecord[]> {
  return listFlagsForTarget(db, targetType, targetId);
}

export interface ResolveFlagCommand extends ResolveFlagInput {
  flagId: string;
  adminUserId: string;
  at?: Date;
}

/**
 * Resolve, then audit — FR-14.2 and FR-14.4.
 *
 * The audit entry is appended **after** the row is updated and carries both the
 * previous state and the new one, so the log answers "what changed" rather than
 * only "what is". It records the reporter's id as context for the next
 * administrator; it is never rendered to the target of the report.
 */
export async function resolveFlag(db: Executor, input: ResolveFlagCommand): Promise<FlagRecord> {
  const at = input.at ?? new Date();
  const before = await getFlagOrThrow(db, input.flagId);

  if (!isOpenFlagStatus(before.status)) {
    throw new FlagError(
      409,
      'flag_already_resolved',
      'This report has already been resolved. Add a new entry rather than reopening it.',
    );
  }

  const resolved = await markFlagResolved(db, {
    flagId: input.flagId,
    decision: input.decision,
    adminUserId: input.adminUserId,
    reason: input.reason,
    at,
  });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'flag.resolved',
    targetType: before.targetType,
    targetId: before.targetId,
    detailJson: {
      flagId: before.id,
      from: before.status,
      to: input.decision,
      reason: input.reason,
      reportedReason: before.reason,
      reporterUserId: before.reporterUserId,
    },
  });

  return resolved;
}
