/**
 * Platform feedback — §6.32.
 *
 * Two records exist for two questions. A tutor review answers "should I hire
 * this person"; platform feedback answers "is this product working". Merging
 * them would corrupt both — a complaint about a broken Urdu layout would depress
 * somebody's rating, and a genuine concern about a tutor would be triaged as a
 * defect and closed. Nothing here touches `reviews`, and FR-32.10 keeps it off
 * every public surface and out of ranking entirely.
 *
 * ── Why the text is never touched ───────────────────────────────────────────
 *
 * `detail` may be Urdu script, Roman Urdu, English, or all three in one
 * sentence. It is stored byte for byte (FR-32.3, decision 13). No trimming
 * beyond whitespace at the ends, no transliteration, no Latin-only character
 * class, and never machine translation — a user's complaint rewritten by a
 * translator is no longer their complaint.
 */

import { z } from 'zod';

import { antiAbuseFieldsSchema } from './anti-abuse';

export const FEEDBACK_CATEGORIES = [
  'defect',
  'usability',
  'incorrect_ai_output',
  'missing_feature',
  'content_or_safety',
  'other',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['new', 'triaged', 'actioned', 'declined'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * The category that changes how the record is handled.
 *
 * A `content_or_safety` submission is escalated in the queue and handled
 * exactly as FR-9.8 requires: never shown publicly, and never disclosed to the
 * tutor concerned in a form that identifies the reporter (FR-32.8, SEC-26).
 */
export const SAFETY_CATEGORY: FeedbackCategory = 'content_or_safety';

/**
 * An attachment the server receives whole, so it can sniff the bytes.
 *
 * Deliberately not the signed-ticket flow the tutor document upload uses. A
 * ticket has the browser PUT straight to Supabase, which means the server never
 * sees the content and cannot check it — acceptable for a verified tutor
 * uploading a CNIC, not acceptable for a form a stranger can post to.
 */
export const attachmentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['image/png', 'image/jpeg', 'application/pdf']),
  /** Base64, no data-URI prefix. Size is checked against the decoded bytes. */
  contentBase64: z.string().min(1),
});

export type AttachmentInput = z.infer<typeof attachmentSchema>;

export const submitFeedbackSchema = antiAbuseFieldsSchema.extend({
  category: z.enum(FEEDBACK_CATEGORIES),
  /**
   * The whole Unicode range, both scripts, no normalisation. `.min(1)` after a
   * trim only so an empty box is rejected — that is the only transformation.
   */
  detail: z.string().trim().min(1).max(5_000),
  satisfactionRating: z.number().int().min(1).max(5).nullable().optional(),

  /**
   * Context (FR-32.4).
   *
   * The client may state the page it was on; **role, locale and version are
   * taken from the request** by the service and whatever the client sent for
   * them is discarded. The most common reason a defect report is unusable is
   * that nobody can reproduce it, and the reporter should not have to be
   * interrogated for facts the server already knows.
   */
  pagePath: z.string().max(500).optional(),
  locale: z.enum(['en', 'ur']).optional(),

  attachment: attachmentSchema.nullable().optional(),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

export const triageFeedbackSchema = z.object({
  status: z.enum(['triaged', 'actioned', 'declined']),
  /**
   * Required, and required to say something.
   *
   * Every status change writes to the append-only audit log (FR-32.7, §2.7),
   * and an entry reading "declined" with no reason is a record that a decision
   * happened rather than a record of the decision.
   */
  dispositionNote: z.string().trim().min(3).max(2_000),
});

export type TriageFeedbackInput = z.infer<typeof triageFeedbackSchema>;

export const feedbackQueueQuerySchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  /** Safety concerns first, always — but this narrows to only those. */
  safetyOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
