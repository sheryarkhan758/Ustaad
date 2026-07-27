/**
 * Verification contracts — §6.6, §6.28.
 *
 * Every decision in this module requires a **written reason**, including
 * approval. That is not symmetry for its own sake: FR-6.6 makes each decision
 * attributable, and an approval with no reasoning is the one a later reviewer
 * cannot audit. "Checked CNIC against the uploaded scan, name and number match"
 * is a record; a bare `approved` is a click.
 */

import { z } from 'zod';

import { VERIFIABLE_ARTEFACTS } from './badges';

/** Reasons are read by a person and may be read years later. */
export const REASON_MIN_LENGTH = 15;
export const REASON_MAX_LENGTH = 2000;

export const reasonSchema = z
  .string()
  .trim()
  .min(
    REASON_MIN_LENGTH,
    `a written reason of at least ${REASON_MIN_LENGTH} characters is required; it is recorded ` +
      'permanently and shown to the tutor where the decision affects them (FR-6.6, FR-6.7)',
  )
  .max(REASON_MAX_LENGTH);

/* -------------------------------------------------------------------------
 * Identity decisions
 * ---------------------------------------------------------------------- */

/**
 * Approval names the artefacts actually inspected, one by one (FR-6.5).
 *
 * At least one is required. An approval that checked nothing is not an
 * approval, and the badge is generated from this list, so an empty list would
 * produce a verified profile with no statement of what was verified.
 */
export const approveIdentitySchema = z.object({
  artefactsChecked: z
    .array(z.enum(VERIFIABLE_ARTEFACTS))
    .min(1, 'record at least one artefact that you checked')
    .refine((a) => new Set(a).size === a.length, 'each artefact may be listed once'),
  reason: reasonSchema,
});

export type ApproveIdentityInput = z.infer<typeof approveIdentitySchema>;

/** A rejection reason is surfaced to the tutor verbatim (FR-6.7). */
export const rejectIdentitySchema = z.object({
  reason: reasonSchema,
  /** Whatever was looked at before deciding. May be empty on a rejection. */
  artefactsChecked: z.array(z.enum(VERIFIABLE_ARTEFACTS)).default([]),
});

export type RejectIdentityInput = z.infer<typeof rejectIdentitySchema>;

export const requestMoreInfoSchema = z.object({
  reason: reasonSchema,
  /** Which artefacts the tutor must supply or replace. */
  missingArtefacts: z.array(z.enum(VERIFIABLE_ARTEFACTS)).default([]),
});

export type RequestMoreInfoInput = z.infer<typeof requestMoreInfoSchema>;

/* -------------------------------------------------------------------------
 * The queue
 * ---------------------------------------------------------------------- */

export const VERIFICATION_QUEUE_STATES = [
  'pending_verification',
  'documents_submitted',
  'under_review',
  'more_info_needed',
  'rejected',
  'approved',
] as const;

export const QUEUE_SORTS = ['oldest_first', 'newest_first', 'city'] as const;

/**
 * `oldest_first` is the default deliberately.
 *
 * A queue sorted newest-first starves its tail, and the tail here is people
 * waiting to be allowed to earn. Oldest-first is also a **stable** order: the
 * tiebreaker is the profile id, so two profiles submitted in the same
 * millisecond do not swap places between page loads and cause an administrator
 * to review one twice and another never.
 */
export const verificationQueueQuerySchema = z.object({
  status: z.enum(VERIFICATION_QUEUE_STATES).optional(),
  cityId: z.string().min(1).optional(),
  /** Only profiles flagged for a duplicate CNIC (FR-28.7). */
  duplicateCnicOnly: z.coerce.boolean().optional(),
  sort: z.enum(QUEUE_SORTS).default('oldest_first'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export type VerificationQueueQuery = z.infer<typeof verificationQueueQuerySchema>;

/* -------------------------------------------------------------------------
 * CNIC
 * ---------------------------------------------------------------------- */

/**
 * Pakistani CNIC: 13 digits, conventionally `12345-1234567-1`.
 *
 * Validated in shape only, and **only ever as a transient value on its way into
 * a hash**. It is not a field on any record, is never returned by any endpoint,
 * and never appears in a log line (SEC-8, NFR-10, CLAUDE.md §2.2).
 */
export const cnicSchema = z
  .string()
  .trim()
  .regex(/^\d{5}-?\d{7}-?\d$/, 'a CNIC is 13 digits, for example 42101-1234567-1');

export const submitCnicSchema = z.object({ cnic: cnicSchema });

/** Digits only, so `42101-1234567-1` and `4210112345671` hash identically. */
export function normaliseCnic(value: string): string {
  return value.replace(/\D/g, '');
}

/* -------------------------------------------------------------------------
 * Appeals — §6.28, SEC-18, decision 12
 * ---------------------------------------------------------------------- */

export const fileAppealSchema = z.object({
  againstRecordId: z.string().min(1),
  /** The tutor's own words. Any script, stored unchanged (§2.10). */
  tutorReason: reasonSchema,
});

export type FileAppealInput = z.infer<typeof fileAppealSchema>;

/**
 * An administrator's ruling on an appeal.
 *
 * `uphold` overturns the original decision; `dismiss` lets it stand. Both
 * require a written reason and both are stored permanently (FR-28.5, FR-28.6).
 */
export const decideAppealSchema = z.object({
  outcome: z.enum(['uphold', 'dismiss']),
  reason: reasonSchema,
  /** On upholding an identity rejection, what the override records as checked. */
  artefactsChecked: z.array(z.enum(VERIFIABLE_ARTEFACTS)).default([]),
});

export type DecideAppealInput = z.infer<typeof decideAppealSchema>;

/* -------------------------------------------------------------------------
 * Document viewing
 * ---------------------------------------------------------------------- */

/**
 * Every document view is logged (SEC-7, NFR-9), so the reason is part of the
 * request rather than an afterthought.
 */
export const viewDocumentSchema = z.object({
  purpose: z
    .enum(['identity_verification', 'appeal_review', 'duplicate_investigation', 'dispute'])
    .default('identity_verification'),
});

export type ViewDocumentInput = z.infer<typeof viewDocumentSchema>;
