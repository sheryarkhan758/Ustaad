/**
 * What a client may ask an AI endpoint for — §6.10, §6.11, §6.26.
 *
 * ── Requests here, responses in `ai-contract.ts` ───────────────────────────
 * `ai-contract.ts` is what a **model** may return. This file is what a
 * **caller** may send. They are deliberately separate: the first is a boundary
 * against a model inventing a figure, the second is ordinary input validation,
 * and conflating them would put the family's hard constraints in the same file
 * as the model's output schema — which is exactly the confusion §7.2 exists to
 * prevent.
 *
 * ── Why these moved out of the route file ──────────────────────────────────
 * They were route-local, which works until a client wants to validate before
 * posting. A conversational form that discovers the 2000-character ceiling
 * only after a parent has typed 2400 characters about their child has wasted
 * the one thing this feature is asking them for.
 *
 * ── The constraint object is the important one ─────────────────────────────
 * `constraints` carries gender, area and budget. They arrive here, are handed
 * to the **search predicate**, and never enter a prompt. `searchToolCallSchema`
 * in `ai-contract.ts` has no field for any of them, so a model cannot relax a
 * constraint it has no way to express (FR-10.12, FR-16.4, §2.4).
 */

import { z } from 'zod';

import { GENDER_PREFERENCES } from './search';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/* -------------------------------------------------------------------------
 * Agent 1 — diagnostic intake (§6.10)
 * ---------------------------------------------------------------------- */

export const startIntakeSchema = z.object({
  /** What the family came to say, in their own words and script (§2.10). */
  goal: z.string().min(1).max(500),
  studentProfileId: z.string().min(1).nullable().default(null),
});

export type StartIntakeInput = z.infer<typeof startIntakeSchema>;

/**
 * The family's hard constraints.
 *
 * Applied in application code **after** the model has spoken. There is no
 * ordering here and no weight — a tutor who does not satisfy one is absent
 * from the result, not ranked lower (§2.4, decision 8).
 */
export const intakeConstraintsSchema = z.object({
  genderPreference: z.enum(GENDER_PREFERENCES).default('no_preference'),
  cityId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  /** Paisa per hour. Integer, always (§2.1). */
  maxHourlyRate: z.number().int().positive().optional(),
});

export type IntakeConstraints = z.infer<typeof intakeConstraintsSchema>;

export const intakeTurnSchema = z.object({
  message: z.string().min(1).max(2000),
  subjectId: z.string().min(1).optional(),
  constraints: intakeConstraintsSchema.optional(),
});

export type IntakeTurnInput = z.infer<typeof intakeTurnSchema>;

/* -------------------------------------------------------------------------
 * Agent 2 — competency verification (§6.11)
 * ---------------------------------------------------------------------- */

export const startVerificationSchema = z.object({
  claimId: z.string().min(1),
  topicId: z.string().min(1),
  /**
   * A second attempt after a failure, permitted once (FR-28.3).
   *
   * The flag is sent by the tutor because an appeal is a thing she chooses to
   * do; whether she is *allowed* to is decided by `appealCount` on the claim,
   * server-side, and a client that lies about this gets a 409.
   */
  isAppeal: z.boolean().default(false),
});

export type StartVerificationInput = z.infer<typeof startVerificationSchema>;

export const submitAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        itemId: z.string().min(1),
        /** Any script, stored unchanged, never translated (§2.10). */
        answer: z.string().max(4000),
      }),
    )
    .min(1)
    .max(4),
});

export type SubmitAnswersInput = z.infer<typeof submitAnswersSchema>;

/* -------------------------------------------------------------------------
 * Study plan (§6.26)
 * ---------------------------------------------------------------------- */

/**
 * Dates are the caller's and the application's — never the model's.
 *
 * FR-26.4 puts all date arithmetic in code. The model receives no dates and
 * emits none; it returns `weekOffset` ordinals which `server/ai/study-plan.ts`
 * turns into real weeks between these two dates.
 */
export const generateStudyPlanSchema = z
  .object({
    diagnosticId: z.string().min(1),
    startDate: isoDate,
    targetDate: isoDate,
    levelId: z.string().min(1).nullable().default(null),
  })
  .refine((value) => value.targetDate > value.startDate, {
    path: ['targetDate'],
    message: 'the exam date must be after the start date',
  });

export type GenerateStudyPlanInput = z.infer<typeof generateStudyPlanSchema>;
