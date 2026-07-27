/**
 * Booking contracts — §6.8, §6.20, §6.30.
 *
 * ── A single session is a first-class engagement ───────────────────────────
 * §2.6: the market's smallest purchasable unit is a month, roughly thirty times
 * the smallest real need. A student who needs one hour on one misunderstood
 * concept cannot buy it, so the need goes unmet. The single-session shape here
 * is therefore **not** a monthly booking with fields removed:
 *
 *  · it **requires** a declared purpose and topic ids, so the tutor arrives
 *    prepared rather than spending the hour finding out why they came
 *    (FR-30.4);
 *  · it earns a **real review** on completion, exactly as a monthly engagement
 *    does (FR-30.11) — a review gate that excluded single sessions would make
 *    the shortest engagements invisible in the signal families rely on.
 */

import { z } from 'zod';

import { TEACHING_MODES } from './rates';

/** §6.30, decision 19. */
export const ENGAGEMENT_TYPES = [
  'monthly',
  'short_term_package',
  'single_session',
  'group',
] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

/** FR-30.4. Why this hour is being bought. */
export const SESSION_PURPOSES = [
  'concept_clarification',
  'assessment_review',
  'doubt_solving',
  'exam_revision',
] as const;

const isoInstant = z.string().datetime({ offset: false });

const base = z.object({
  tutorId: z.string().min(1),
  studentProfileId: z.string().min(1),
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  boardId: z.string().min(1),
  mode: z.enum(TEACHING_MODES),
  /**
   * Which kind of engagement this is — FR-29.4.
   *
   * Academic tuition, personality grooming and mentoring, Quran and Islamiat,
   * spoken English. A family arranging home tuition frequently wants academic
   * work *and* mentoring from the same visit, and the informal market's failure
   * to offer that reliably is part of what §2.1 describes. Recording it on the
   * booking is what lets the tutor prepare for the engagement she was actually
   * asked for.
   *
   * Optional: the ordinary academic booking made from a tutor's profile does
   * not need to answer a question the pathway asks explicitly.
   */
  serviceTypeId: z.string().min(1).optional(),
  areaId: z.string().min(1).nullable().default(null),
  /** ISO-8601 UTC. Must match a free slot from the tutor's template. */
  slotStart: isoInstant,
  slotEnd: isoInstant,
  topicIds: z.array(z.string().min(1)).max(40).default([]),
  /**
   * The family's acknowledgement that a guardian will be present.
   *
   * Required when the tutor has declared it (SEC-19, FR-29.11) — the request is
   * refused without it rather than the tutor being left to notice.
   */
  guardianPresenceAcknowledged: z.boolean().default(false),
  /** Plaintext. Sealed by `server/services/address.ts` before it is stored. */
  address: z.string().trim().min(5).max(500).optional(),
  isTrial: z.boolean().default(false),
});

/**
 * The three shapes. A discriminated union rather than one schema with optional
 * fields, so "a single session with no purpose" is not representable.
 */
export const createBookingSchema = z
  .discriminatedUnion('engagementType', [
    base.extend({
      engagementType: z.literal('monthly'),
      /** Recurring cycle: how many sessions a week, for how many weeks. */
      sessionsPerWeek: z.number().int().min(1).max(7),
      cycleWeeks: z.number().int().min(1).max(12).default(4),
    }),
    base.extend({
      engagementType: z.literal('short_term_package'),
      packageSessionsTotal: z.number().int().min(2).max(40),
    }),
    base.extend({
      engagementType: z.literal('single_session'),
      /** Required. The tutor arrives knowing what the hour is for (FR-30.4). */
      sessionPurpose: z.enum(SESSION_PURPOSES),
      /** Required and non-empty, for the same reason. */
      topicIds: z.array(z.string().min(1)).min(1).max(10),
    }),
    base.extend({
      engagementType: z.literal('group'),
      groupProposalId: z.string().min(1),
    }),
  ])
  .refine((v) => v.slotEnd > v.slotStart, {
    path: ['slotEnd'],
    message: 'the session must end after it starts',
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/* -------------------------------------------------------------------------
 * Lifecycle
 * ---------------------------------------------------------------------- */

export const transitionBookingSchema = z
  .object({
    to: z.enum(['confirmed', 'in_progress', 'completed', 'cancelled', 'declined', 'no_show']),
    reason: z.string().trim().max(1000).optional(),
    /**
     * Set by a tutor declining because of a condition she declared
     * (SEC-21, FR-29.14). It must be supplied at the moment of the decline: the
     * reliability job removes these from her confirmation-rate denominator, and
     * the fact cannot be reconstructed afterwards.
     */
    declineUnderSafetyConstraint: z.boolean().default(false),
  })
  .refine((v) => !(v.to === 'cancelled' || v.to === 'declined') || !!v.reason, {
    path: ['reason'],
    message: 'a reason is required when cancelling or declining',
  });

export type TransitionBookingInput = z.infer<typeof transitionBookingSchema>;

/* -------------------------------------------------------------------------
 * Trial fit check — §6.20, SEC-15, decision 11
 * ---------------------------------------------------------------------- */

const oneToFive = z.number().int().min(1).max(5);

/**
 * **Private to the requesting family and to administrators.**
 *
 * Never shown to the tutor, never on a public profile, never a ranking input.
 * That privacy is not a courtesy — it is what keeps the answers candid. A
 * family that expects the tutor to read this writes nothing useful, and the
 * whole point of a trial is to find out before committing to a month.
 */
export const trialFitCheckSchema = z.object({
  communication: oneToFive,
  punctuality: oneToFive,
  engagement: oneToFive,
  pace: oneToFive,
  continueDecision: z.boolean(),
  /** Any script, stored unchanged, never translated (§2.10). */
  note: z.string().trim().max(2000).optional(),
});

export type TrialFitCheckInput = z.infer<typeof trialFitCheckSchema>;

/* -------------------------------------------------------------------------
 * Session notes — §6.12, FR-12.1
 * ---------------------------------------------------------------------- */

export const sessionNoteSchema = z.object({
  topicsCovered: z.array(z.string().min(1)).min(1).max(40),
  /** `{ [topicId]: 1..5 }`. Feeds the parent-facing progress ledger. */
  masteryRatings: z.record(z.string().min(1), oneToFive),
  note: z.string().trim().max(4000).optional(),
});

export type SessionNoteInput = z.infer<typeof sessionNoteSchema>;

export const slotQuerySchema = z.object({
  tutorId: z.string().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotMinutes: z.coerce.number().int().min(30).max(240).default(60),
  mode: z.enum(TEACHING_MODES).optional(),
});
