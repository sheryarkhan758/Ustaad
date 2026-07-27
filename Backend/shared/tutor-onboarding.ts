/**
 * Tutor onboarding contracts — §6.4, §6.5, §6.29.2.
 *
 * Two rules are enforced by the *shape* of these schemas rather than by a check
 * a handler has to remember:
 *
 *  · **No schema here has a `profileStatus` field that accepts `approved`.**
 *    A tutor submits; an administrator approves (§6.6, decision 17, FR-6.3).
 *  · **No schema here has a `claimStatus` field at all.** A claim is recorded
 *    as `asserted` and only Agent 2's assessment moves it (§2.2, §6.11).
 *
 * A field that does not exist cannot be set by a request body, however the
 * handler is written later.
 */

import { z } from 'zod';

import { RATE_TYPES, TEACHING_MODES, type TeachingMode } from './rates';

/* -------------------------------------------------------------------------
 * Profile — §6.4
 * ---------------------------------------------------------------------- */

/**
 * Required, and binary (FR-16.1).
 *
 * Gender preference is a hard exclusion, so a family requiring a female tutor
 * receives a result set from which every other tutor is absent. A third or
 * undeclared value has no defensible behaviour under that rule.
 */
export const tutorGenderSchema = z.enum(['female', 'male']);

/** Free text in any script, stored byte-for-byte, never translated (§2.10). */
const freeText = (max: number) => z.string().trim().max(max);

export const tutorProfileCreateSchema = z.object({
  gender: tutorGenderSchema,
  cityId: z.string().min(1),
  bio: freeText(4000).optional(),
  bioUr: freeText(4000).optional(),
  qualifications: freeText(2000).optional(),
  experienceYears: z.number().int().min(0).max(60).default(0),
  teachesAtHome: z.boolean().default(false),
  teachesOnline: z.boolean().default(false),
  teachesAtOwnPlace: z.boolean().default(false),
  /** Areas the tutor will travel to (FR-2.7, FR-29.12). */
  willingAreaIds: z.array(z.string().min(1)).max(60).default([]),
  volunteer: z.boolean().default(false),
});

export type TutorProfileCreateInput = z.infer<typeof tutorProfileCreateSchema>;

export const tutorProfileUpdateSchema = tutorProfileCreateSchema.partial();
export type TutorProfileUpdateInput = z.infer<typeof tutorProfileUpdateSchema>;

/* -------------------------------------------------------------------------
 * Subject claims — §6.4, FR-4.4
 * ---------------------------------------------------------------------- */

/**
 * A claim is scoped to one (subject, level, board) triple.
 *
 * Board is part of the claim rather than a detail of it: a Sindh Board Matric
 * Mathematics tutor and a Cambridge O Level Mathematics tutor are not
 * interchangeable (decision 5).
 *
 * There is **no `claimStatus` field**. The endpoint records `asserted` and
 * nothing a request can say will change that.
 */
export const subjectClaimSchema = z.object({
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  boardId: z.string().min(1),
  topicIds: z.array(z.string().min(1)).min(1).max(80),
});

export type SubjectClaimInput = z.infer<typeof subjectClaimSchema>;

/* -------------------------------------------------------------------------
 * Rates — §6.5
 * ---------------------------------------------------------------------- */

/**
 * All amounts are **integer paisa** (1 PKR = 100 paisa).
 *
 * `normalisedHourlyAmount` is deliberately absent: it is computed on write by
 * `shared/rates.ts#normaliseHourlyAmount`, so a request cannot supply a figure
 * that disagrees with the rate it was derived from and quietly skew every
 * benchmark computed from it.
 */
export const tutorRateSchema = z
  .object({
    /** Null means a blanket rate covering everything the tutor teaches. */
    subjectId: z.string().min(1).nullable().default(null),
    levelId: z.string().min(1).nullable().default(null),
    rateType: z.enum(RATE_TYPES),
    amount: z.number().int().nonnegative(),
    sessionsPerWeek: z.number().int().min(1).max(7).nullable().default(null),
    minutesPerSession: z.number().int().min(15).max(480).nullable().default(null),
    mode: z.enum(TEACHING_MODES),
    groupSizeMax: z.number().int().min(2).max(12).nullable().default(null),
    /** Paisa, per student per month. Required for a group rate. */
    perHeadAmount: z.number().int().nonnegative().nullable().default(null),
    negotiable: z.boolean().default(false),
    /** Paisa. A separate recorded line, never folded into the rate (FR-31.2). */
    travelCharge: z.number().int().nonnegative().default(0),
  })
  .superRefine((value, ctx) => {
    const need = (field: keyof typeof value, why: string) => {
      if (value[field] === null || value[field] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: why });
      }
    };

    if (value.rateType === 'monthly' || value.rateType === 'group_monthly') {
      need('sessionsPerWeek', 'sessions per week is required for a monthly rate');
      need('minutesPerSession', 'session length is required for a monthly rate');
    }
    if (value.rateType === 'single_session') {
      need('minutesPerSession', 'session length is required for a single-session rate');
    }
    if (value.rateType === 'group_monthly') {
      need('perHeadAmount', 'a per-head amount is required for a group rate');
      need('groupSizeMax', 'a maximum group size is required for a group rate');
    }
    // A travel charge on an online session is a data-entry mistake, not a price.
    if (value.mode === 'online' && value.travelCharge > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travelCharge'],
        message: 'an online session cannot carry a travel charge',
      });
    }
  });

export type TutorRateInput = z.infer<typeof tutorRateSchema>;

/* -------------------------------------------------------------------------
 * Availability — FR-8.1, FR-8.2
 * ---------------------------------------------------------------------- */

/** Zero-padded `HH:MM`, whose lexicographic order is chronological. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM in 24-hour form');

export const availabilitySlotSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    mode: z.enum(TEACHING_MODES),
    /** Set when the slot is offered only in one area. */
    areaId: z.string().min(1).nullable().default(null),
  })
  .refine((v) => v.startTime < v.endTime, {
    path: ['endTime'],
    message: 'the slot must end after it starts',
  });

export type AvailabilitySlotInput = z.infer<typeof availabilitySlotSchema>;

/* -------------------------------------------------------------------------
 * Safety constraints — §6.29.2, SEC-19 to SEC-21
 * ---------------------------------------------------------------------- */

/**
 * A tutor's own conditions.
 *
 * **These are enforcement inputs, not profile decoration** (SEC-19). A tutor
 * restricted to female students is absent from a search for a male student, in
 * the same way a family's gender preference excludes rather than deprioritises.
 * A decline made under one of these is excluded from her public
 * confirmation-rate statistic (SEC-21), so holding to them costs her nothing.
 */
export const safetyConstraintsSchema = z.object({
  femaleStudentsOnly: z.boolean().default(false),
  guardianPresenceRequired: z.boolean().default(false),
  /** Areas she will not travel to, whatever the profile says she serves. */
  restrictedAreaIds: z.array(z.string().min(1)).max(200).default([]),
});

export type SafetyConstraintsInput = z.infer<typeof safetyConstraintsSchema>;

/**
 * The conditions as a family reads them off the public profile.
 *
 * The same three fields, named from the other side of the transaction. They are
 * published deliberately: a condition the family cannot see is one they can
 * only discover by having a request refused, and a refusal she never had to
 * issue is the point of enforcing these at all (FR-29.11).
 */
export interface PublishedSafetyConstraints {
  femaleStudentsOnly: boolean;
  guardianPresenceRequired: boolean;
  restrictedAreaIds: readonly string[];
}

export interface ProposedEngagement {
  studentGender: 'female' | 'male' | 'other' | null;
  areaId: string | null;
  guardianPresenceOffered: boolean;
  mode: TeachingMode;
}

export interface ConstraintViolation {
  constraint: 'female_students_only' | 'guardian_presence_required' | 'restricted_area';
  message: string;
}

/**
 * Check a proposed booking against the tutor's declared conditions.
 *
 * **This lives in `/shared` so that both sides run the same function.** The
 * booking engine calls it before a request is created, and the booking form
 * calls it before the form can be submitted — so a family is told which
 * condition applies while they can still change their answer, rather than
 * meeting a 409 after filling the whole form in.
 *
 * The duplication that would otherwise be tempting is the danger: a UI copy of
 * these rules that drifted would either block bookings the server allows, or
 * let through requests she would have to decline. SEC-21 excludes safety
 * declines from her confirmation-rate statistic precisely so she is not
 * penalised for holding to her conditions; the cleanest way to honour that is
 * for the decline never to be necessary.
 *
 * Returns violations rather than throwing, so a caller can choose between
 * refusing the booking, disabling a control, and hiding the tutor entirely.
 */
export function checkEngagementAgainstConstraints(
  constraints: PublishedSafetyConstraints,
  engagement: ProposedEngagement,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (constraints.femaleStudentsOnly && engagement.studentGender !== 'female') {
    violations.push({
      constraint: 'female_students_only',
      message: 'This tutor teaches female students only.',
    });
  }

  if (constraints.guardianPresenceRequired && !engagement.guardianPresenceOffered) {
    violations.push({
      constraint: 'guardian_presence_required',
      message: 'This tutor requires a guardian to be present during the session.',
    });
  }

  // Only relevant when she would have to travel.
  if (
    engagement.mode === 'home' &&
    engagement.areaId !== null &&
    constraints.restrictedAreaIds.includes(engagement.areaId)
  ) {
    violations.push({
      constraint: 'restricted_area',
      message: 'This tutor does not travel to that area.',
    });
  }

  return violations;
}

/* -------------------------------------------------------------------------
 * Documents — SEC-7, NFR-9
 * ---------------------------------------------------------------------- */

export const DOCUMENT_TYPES = ['cnic_front', 'cnic_back', 'degree', 'transcript', 'other'] as const;

export const uploadTicketRequestSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024, 'the limit is 5 MB'),
});

export type UploadTicketRequest = z.infer<typeof uploadTicketRequestSchema>;

/**
 * Confirmation that the browser finished uploading.
 *
 * Only `storagePath` is accepted, and it must match a ticket this server
 * issued: a client cannot name an arbitrary key and have it recorded against
 * their profile.
 */
export const confirmDocumentSchema = z.object({
  docType: z.enum(DOCUMENT_TYPES),
  storagePath: z.string().min(1).max(400),
});

export type ConfirmDocumentInput = z.infer<typeof confirmDocumentSchema>;
