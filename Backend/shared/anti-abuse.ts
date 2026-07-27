/**
 * Bot controls for the two publicly reachable forms — FR-32.6, FR-33.8.
 *
 * Feedback and the volunteer application can both be submitted with no account.
 * That is deliberate — a visitor who could not report a broken Urdu layout
 * without registering simply leaves, and a retired teacher willing to give four
 * hours a week should not have to create a password first. It also means both
 * endpoints are reachable by anyone with a terminal, and one of them sends mail.
 *
 * Three controls, none of which is sufficient alone:
 *
 *  1. **Rate limiting** by IP, in `server/middleware/rate-limit.ts`.
 *  2. **A honeypot field**, checked here.
 *  3. **A minimum time on form**, checked here.
 *
 * ── What these are not ──────────────────────────────────────────────────────
 *
 * The honeypot and the timer are both client-supplied and both trivially
 * defeated by anyone who reads the page source. They are not a security
 * boundary and nothing here treats them as one; they filter the indiscriminate
 * form-filling traffic that makes up nearly all of it, at no cost to a real
 * person. The rate limiter is the control that holds when someone is actually
 * trying.
 *
 * Which is why the time check is generous. Three seconds rejects a script that
 * posts instantly and accepts a person who pastes a prepared paragraph. A
 * thirty-second floor would reject the applicant who had already written their
 * motivation in Notes, and rejecting a genuine volunteer costs more than
 * admitting a bot that the rate limiter will stop anyway.
 */

import { z } from 'zod';

/** The field a real person never sees and never fills. */
export const HONEYPOT_FIELD = 'websiteUrl';

/** Milliseconds. Below this, nobody typed anything. */
export const MIN_TIME_ON_FORM_MS = 3_000;

/**
 * Absurdly long, and still accepted.
 *
 * A form left open over lunch is a real submission. This only guards against a
 * client sending a nonsensical value to game the lower bound.
 */
export const MAX_TIME_ON_FORM_MS = 24 * 60 * 60 * 1000;

export class BotSuspectedError extends Error {
  readonly status = 400;
  readonly code = 'submission_rejected';

  constructor() {
    // Deliberately vague and identical for both causes. Naming the honeypot
    // field, or the threshold, is a free tuning guide for the next attempt.
    super('That submission could not be accepted. Please try again.');
    this.name = 'BotSuspectedError';
  }
}

/**
 * The two client-supplied signals every public form carries.
 *
 * `.optional()` on both, because the check below decides what a missing value
 * means — a schema that rejected an absent honeypot would fail every legitimate
 * client that had not been updated yet, which is a worse failure than the one
 * it prevents.
 */
export const antiAbuseFieldsSchema = z.object({
  /** Must be empty. Named to look worth filling in. */
  [HONEYPOT_FIELD]: z.string().max(200).optional(),
  /** Milliseconds the form was open, measured by the client. */
  timeOnFormMs: z.number().int().min(0).max(MAX_TIME_ON_FORM_MS).optional(),
});

export type AntiAbuseFields = z.infer<typeof antiAbuseFieldsSchema>;

/**
 * Throws `BotSuspectedError` when a submission looks automated.
 *
 * A **missing** `timeOnFormMs` passes: an absent measurement is not evidence of
 * anything, and treating it as such would break every non-browser client. A
 * present one below the floor fails, because a client that bothered to send the
 * field and reported 40 ms is telling you what it is.
 */
export function assertNotAutomated(fields: AntiAbuseFields): void {
  const honeypot = fields[HONEYPOT_FIELD];
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    throw new BotSuspectedError();
  }

  if (typeof fields.timeOnFormMs === 'number' && fields.timeOnFormMs < MIN_TIME_ON_FORM_MS) {
    throw new BotSuspectedError();
  }
}
