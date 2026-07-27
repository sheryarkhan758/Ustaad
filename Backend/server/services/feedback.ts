/**
 * Platform feedback — §6.32, SEC-26.
 *
 * ── The order, again ────────────────────────────────────────────────────────
 *
 * Row first, mail second, outcome recorded third (FR-32.9, and the same reason
 * FR-33.9 gives). `dispatch` cannot throw, so the third step always runs.
 *
 * ── What an anonymous record contains ───────────────────────────────────────
 *
 * Nothing. Not a name, not an email, not an IP address, not a session id
 * (FR-32.6). `userId` and `role` are both null and the service does not have
 * them to write — the route passes `null`, not "the authenticated user if there
 * happens to be one", so there is no branch where an identity leaks in by
 * accident. Rate limiting is the abuse control; identification is not.
 *
 * ── SEC-26 ──────────────────────────────────────────────────────────────────
 *
 * A `content_or_safety` submission is escalated and handled exactly as FR-9.8
 * requires. `listSafetyConcerns` is administrator-only, nothing in this module
 * is reachable by a tutor, and `redactForTutorDisclosure` exists so that the
 * one case where a concern must reach a tutor — an administrator putting an
 * allegation to them — goes through a function that strips the reporter rather
 * than through somebody's judgement at the time.
 */

import type { FeedbackCategory, SubmitFeedbackInput } from '../../shared/feedback';
import { SAFETY_CATEGORY } from '../../shared/feedback';
import type { Lang } from '../db/schema/reference';
import {
  createFeedback,
  getFeedbackOrThrow,
  recordMailDispatch,
  triageFeedback as writeTriage,
  type FeedbackRecord,
} from '../repositories/feedback';
import type { Executor } from '../repositories/_base';
import type { UserRole } from '../db/schema/identity';
import { appendAdminAction } from './audit';
import { dispatch } from './mail';
import { storeSubmittedFile } from './submitted-files';

export class FeedbackError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'FeedbackError';
    this.status = status;
    this.code = code;
  }
}

export interface SubmitFeedbackContext {
  /** Null for an anonymous visitor. Never inferred from anything else. */
  userId: string | null;
  role: UserRole | null;
  /** Captured from the request, not from the body (FR-32.4). */
  locale: Lang | null;
  appVersion: string | null;
}

export interface SubmitFeedbackResult {
  feedback: FeedbackRecord;
  /** In-application acknowledgement text (FR-32.9). */
  acknowledgement: string;
}

export async function submitFeedback(
  db: Executor,
  input: SubmitFeedbackInput,
  context: SubmitFeedbackContext,
): Promise<SubmitFeedbackResult> {
  const anonymous = context.userId === null;
  const safety = input.category === SAFETY_CATEGORY;

  /* --- 1. The attachment, sniffed before anything is written ------------- */

  let attachmentPath: string | null = null;
  if (input.attachment) {
    attachmentPath = await storeSubmittedFile({
      scope: 'feedback',
      // Anonymous submissions still need a path segment. A fresh random id per
      // submission, so two reports cannot be linked by their storage prefix.
      ownerId: context.userId ?? 'anonymous',
      kind: 'attachment',
      file: input.attachment,
    });
  }

  /* --- 2. The row. Before the mail, always. ------------------------------ */

  const feedback = await createFeedback(db, {
    // Both null together. An anonymous record has no identity fields at all.
    userId: anonymous ? null : context.userId,
    role: anonymous ? null : context.role,
    category: input.category,
    // Byte for byte. Whatever script, whatever mixture (FR-32.3).
    detail: input.detail,
    satisfactionRating: input.satisfactionRating ?? null,
    pagePath: input.pagePath ?? null,
    locale: input.locale ?? context.locale,
    appVersion: context.appVersion,
    attachmentPath,
    safetyConcernFlag: safety,
  });

  /* --- 3. Notify, then record what happened ------------------------------ */

  const result = await dispatch([
    {
      templateEnvVar: 'EMAILJS_TEMPLATE_FEEDBACK',
      params: {
        feedback_id: feedback.id,
        category: feedback.category,
        // Escalation is visible in the subject line, because a safety concern
        // sitting unread in a queue is the failure this flag exists to prevent.
        priority: safety ? 'SAFETY — escalate' : 'normal',
        page_path: feedback.pagePath ?? '(not supplied)',
        locale: feedback.locale ?? '(unknown)',
        app_version: feedback.appVersion ?? '(unknown)',
        // The reporter is not named even to the platform mailbox when the
        // submission was anonymous — there is nothing to name.
        reporter: anonymous ? 'anonymous' : feedback.userId,
        detail: feedback.detail,
        satisfaction: feedback.satisfactionRating,
      },
    },
  ]);

  await recordMailDispatch(db, feedback.id, result.status);

  return {
    feedback: await getFeedbackOrThrow(db, feedback.id),
    acknowledgement: safety
      ? 'Thank you. This has been escalated to an administrator and will not be shown publicly.'
      : 'Thank you. This has gone to the team along with the page you were on.',
  };
}

/* -------------------------------------------------------------------------
 * Triage — FR-32.7
 * ---------------------------------------------------------------------- */

export async function triageFeedback(
  db: Executor,
  input: {
    feedbackId: string;
    adminUserId: string;
    status: 'triaged' | 'actioned' | 'declined';
    dispositionNote: string;
  },
): Promise<FeedbackRecord> {
  const before = await getFeedbackOrThrow(db, input.feedbackId).catch(() => null);
  if (!before) throw new FeedbackError(404, 'not_found', 'No such feedback.');

  const updated = await writeTriage(db, input.feedbackId, {
    status: input.status,
    dispositionNote: input.dispositionNote,
    triagedBy: input.adminUserId,
    at: new Date(),
  });

  // Append-only, and carrying the reasoning (FR-32.7, §2.7). The note is the
  // record; without it the log says a decision happened, not what it was.
  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'platform_feedback.triaged',
    targetType: 'platform_feedback',
    targetId: input.feedbackId,
    detailJson: {
      from: before.status,
      to: input.status,
      category: before.category,
      safetyConcern: before.safetyConcernFlag,
      reason: input.dispositionNote,
    },
  });

  return updated;
}

/* -------------------------------------------------------------------------
 * SEC-26
 * ---------------------------------------------------------------------- */

export interface TutorFacingConcern {
  /** The substance. Never the reporter. */
  category: FeedbackCategory;
  raisedOn: string;
  summary: string;
}

/**
 * What a tutor may be told about a concern raised against them.
 *
 * There is one legitimate reason a `content_or_safety` submission reaches a
 * tutor at all: an administrator putting the substance of an allegation to them
 * so they can answer it. That has to be possible — a person accused of
 * something cannot respond to an accusation they are not shown.
 *
 * It goes through this function so the stripping is a property of the code
 * rather than of whoever is drafting the message. **No id, no user id, no page
 * path, no timestamp finer than a date, and never the detail text**, which
 * routinely identifies its author by what it describes: "the tutor who came on
 * Tuesday to my daughter in Clifton" names a household to the one person who
 * knows which house that is.
 *
 * The administrator writes the summary. A machine cannot judge which sentence
 * of a free-text account is safe to repeat, and this one does not try.
 */
export function redactForTutorDisclosure(
  record: FeedbackRecord,
  administratorSummary: string,
): TutorFacingConcern {
  return {
    category: record.category,
    // Date only. A timestamp to the second, against a tutor's own diary, is
    // enough to work out which family it came from.
    raisedOn: record.createdAt.toISOString().slice(0, 10),
    summary: administratorSummary,
  };
}
