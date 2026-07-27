/**
 * Platform feedback aggregate — §6.32.
 *
 * Feedback about **Ustaad.com itself**, not about a tutor. Administrator-only,
 * never public, never tutor-visible, never a ranking input (FR-32.10, SEC-26).
 *
 * Two things this module will not do, deliberately:
 *
 *  · There is no query that returns feedback by tutor, or joins it to a tutor.
 *    Not providing it is cheaper than providing it and trusting every caller.
 *  · An anonymous submission carries `userId: null` and no other identity
 *    field (FR-32.6). Rate limiting is the abuse control, not identification.
 */

import { and, desc, eq } from 'drizzle-orm';

import { fromDbBool, fromDbTimestamp, newId, nowIso, toDbBool } from '../../shared/db-values';
import { assertPrivateStoragePath } from '../../shared/storage-path';
import type { Lang } from '../db/schema/reference';
import type { UserRole } from '../db/schema/identity';
import { platformFeedback } from '../db/schema/platform';
import type { FeedbackCategory, FeedbackStatus, MailDispatchStatus } from '../db/schema/platform';
import { type Executor, NotFoundError } from './_base';

export interface FeedbackRecord {
  id: string;
  /** NULL for an anonymous submission. */
  userId: string | null;
  role: UserRole | null;
  category: FeedbackCategory;
  /** Any script, stored unchanged, never translated (FR-32.3). */
  detail: string;
  satisfactionRating: number | null;
  pagePath: string | null;
  locale: Lang | null;
  appVersion: string | null;
  attachmentPath: string | null;
  safetyConcernFlag: boolean;
  status: FeedbackStatus;
  dispositionNote: string | null;
  triagedBy: string | null;
  triagedAt: Date | null;
  mailDispatchStatus: MailDispatchStatus;
  createdAt: Date;
}

type Stored = typeof platformFeedback.$inferSelect;

function toDomain(row: Stored): FeedbackRecord {
  return {
    id: row.id,
    userId: row.userId,
    role: row.role,
    category: row.category,
    detail: row.detail,
    satisfactionRating: row.satisfactionRating,
    pagePath: row.pagePath,
    locale: row.locale,
    appVersion: row.appVersion,
    attachmentPath: row.attachmentPath,
    safetyConcernFlag: fromDbBool(row.safetyConcernFlag),
    status: row.status,
    dispositionNote: row.dispositionNote,
    triagedBy: row.triagedBy,
    triagedAt: fromDbTimestamp(row.triagedAt),
    mailDispatchStatus: row.mailDispatchStatus,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export interface CreateFeedbackInput {
  userId?: string | null;
  role?: UserRole | null;
  category: FeedbackCategory;
  detail: string;
  satisfactionRating?: number | null;
  pagePath?: string | null;
  locale?: Lang | null;
  appVersion?: string | null;
  attachmentPath?: string | null;
  safetyConcernFlag?: boolean;
}

/**
 * The row is written **before** any EmailJS dispatch, with
 * `mailDispatchStatus: 'pending'` (FR-32.9, decision 22). EmailJS is a
 * notification channel, not a system of record: a quota reached or a template
 * renamed must never discard a report the user believes was received.
 */
export async function createFeedback(
  db: Executor,
  input: CreateFeedbackInput,
): Promise<FeedbackRecord> {
  if (input.attachmentPath) assertPrivateStoragePath(input.attachmentPath);

  const anonymous = input.userId === null || input.userId === undefined;
  const id = newId();

  await db.insert(platformFeedback).values({
    id,
    userId: anonymous ? null : input.userId!,
    // An anonymous record carries no identity fields at all (FR-32.6).
    role: anonymous ? null : (input.role ?? null),
    category: input.category,
    detail: input.detail,
    satisfactionRating: input.satisfactionRating ?? null,
    pagePath: input.pagePath ?? null,
    locale: input.locale ?? null,
    appVersion: input.appVersion ?? null,
    attachmentPath: input.attachmentPath ?? null,
    safetyConcernFlag: toDbBool(input.safetyConcernFlag ?? false),
    status: 'new',
    mailDispatchStatus: 'pending',
    createdAt: nowIso(),
  });

  return getFeedbackOrThrow(db, id);
}

export async function findFeedback(db: Executor, id: string): Promise<FeedbackRecord | null> {
  const rows = await db
    .select()
    .from(platformFeedback)
    .where(eq(platformFeedback.id, id))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getFeedbackOrThrow(db: Executor, id: string): Promise<FeedbackRecord> {
  const found = await findFeedback(db, id);
  if (!found) throw new NotFoundError('platform feedback', id);
  return found;
}

/** The administrator triage queue (FR-32.7). Administrators only. */
export async function listTriageQueue(
  db: Executor,
  status: FeedbackStatus = 'new',
): Promise<FeedbackRecord[]> {
  const rows = await db
    .select()
    .from(platformFeedback)
    .where(eq(platformFeedback.status, status))
    .orderBy(platformFeedback.createdAt);
  return rows.map(toDomain);
}

/** Safety concerns jump the queue (FR-32.8). */
export async function listSafetyConcerns(db: Executor): Promise<FeedbackRecord[]> {
  const rows = await db
    .select()
    .from(platformFeedback)
    .where(
      and(eq(platformFeedback.safetyConcernFlag, 1), eq(platformFeedback.status, 'new')),
    )
    .orderBy(desc(platformFeedback.createdAt));
  return rows.map(toDomain);
}

export async function recordMailDispatch(
  db: Executor,
  id: string,
  outcome: MailDispatchStatus,
): Promise<FeedbackRecord> {
  await db
    .update(platformFeedback)
    .set({ mailDispatchStatus: outcome })
    .where(eq(platformFeedback.id, id));
  return getFeedbackOrThrow(db, id);
}

export async function triageFeedback(
  db: Executor,
  id: string,
  input: { status: FeedbackStatus; triagedBy: string; dispositionNote?: string | null; at: Date },
): Promise<FeedbackRecord> {
  await db
    .update(platformFeedback)
    .set({
      status: input.status,
      triagedBy: input.triagedBy,
      dispositionNote: input.dispositionNote ?? null,
      triagedAt: input.at.toISOString(),
    })
    .where(eq(platformFeedback.id, id));
  return getFeedbackOrThrow(db, id);
}

export async function deleteFeedback(db: Executor, id: string): Promise<void> {
  await db.delete(platformFeedback).where(eq(platformFeedback.id, id));
}
