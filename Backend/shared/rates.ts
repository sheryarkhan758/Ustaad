/**
 * Rate normalisation — specification §2.7, §6.19, FR-5.x.
 *
 * The market quotes prices in incompatible units.  "Rupees eight thousand a
 * month for three days a week" and "rupees nine hundred an hour" cannot be
 * compared by inspection, and nobody does the arithmetic — so tutors under-price
 * themselves and families over-pay, both in ignorance.  This module does the
 * arithmetic, once, deterministically, on write.
 *
 * Two rules govern everything here.
 *
 * **Money is integer paisa.**  1 PKR = 100 paisa.  Every monetary column in the
 * schema and every amount in this module is an integer count of paisa.  Floats
 * accumulate error under repeated arithmetic and behave differently in SQLite
 * and Postgres; an integer does neither.  Convert at the interface boundary
 * with `rupeesToPaisa` / `paisaToRupees`, never in the middle of a calculation.
 *
 * **This is application code, not a model.**  Normalised rates are a numeric
 * output visible to users, so §7.2 puts them squarely on the deterministic
 * side of the line: the model never emits a price (CLAUDE.md §2.9).
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------
 * Units
 * ---------------------------------------------------------------------- */

export const PAISA_PER_RUPEE = 100;

/**
 * Weeks in an average month, `52 / 12` ≈ 4.3333.
 *
 * The alternative convention is a flat 4.  It is wrong over any period longer
 * than a month: a tutor engaged for three sessions a week actually delivers
 * 52 × 3 = 156 sessions a year, not 48 × 3 = 144, so a flat 4 overstates the
 * hourly equivalent by about 8% and would make monthly rates look dearer than
 * they are next to a genuine hourly quote.  Because the whole point of this
 * module is comparability, the calendrically correct figure is used.
 *
 * Exported and named so that changing the convention is one edit and one test
 * update, not a hunt through the codebase.
 */
export const WEEKS_PER_MONTH = 52 / 12;

export function rupeesToPaisa(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RateNormalisationError('amount must be a finite number');
  return Math.round(rupees * PAISA_PER_RUPEE);
}

export function paisaToRupees(paisa: number): number {
  return paisa / PAISA_PER_RUPEE;
}

/** `41026` → `"410.26"`. Display only — never feed this back into arithmetic. */
export function formatPaisa(paisa: number): string {
  return (paisa / PAISA_PER_RUPEE).toFixed(2);
}

/* -------------------------------------------------------------------------
 * Rate shapes
 * ---------------------------------------------------------------------- */

/**
 * The four ways this market prices tuition (decision 3, decision 19).
 *
 * `monthly` is primary because that is how Pakistani tuition is actually
 * contracted.  `single_session` exists because §2.6 identifies a market whose
 * smallest purchasable unit is roughly thirty times the smallest real need.
 */
export const RATE_TYPES = ['monthly', 'hourly', 'single_session', 'group_monthly'] as const;
export type RateType = (typeof RATE_TYPES)[number];

/** Delivery mode.  `home` is the restricted-mobility pathway's mode (§6.29). */
export const TEACHING_MODES = ['home', 'online', 'own_place'] as const;
export type TeachingMode = (typeof TEACHING_MODES)[number];

export class RateNormalisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateNormalisationError';
  }
}

export interface RateInput {
  rateType: RateType;
  /** Paisa.  For `group_monthly` this is what the tutor receives in total. */
  amount: number;
  /** Required for `monthly` and `group_monthly`. */
  sessionsPerWeek?: number | null;
  /** Required for every type except `hourly`. */
  minutesPerSession?: number | null;
  /** Paisa, per student per month.  Required for `group_monthly`. */
  perHeadAmount?: number | null;
  /** Required for `group_monthly`. */
  groupSizeMax?: number | null;
}

/**
 * Shared validation schema.  Used by the client form and by the server
 * endpoint (NFR-7) — the same object, so the two cannot drift.
 */
export const rateInputSchema = z
  .object({
    rateType: z.enum(RATE_TYPES),
    amount: z.number().int().nonnegative(),
    sessionsPerWeek: z.number().int().min(1).max(7).nullable().optional(),
    minutesPerSession: z.number().int().min(15).max(480).nullable().optional(),
    perHeadAmount: z.number().int().nonnegative().nullable().optional(),
    groupSizeMax: z.number().int().min(2).max(12).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const require = (field: keyof RateInput, why: string) => {
      const v = value[field as keyof typeof value];
      if (v === null || v === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: why });
      }
    };

    if (value.rateType === 'monthly' || value.rateType === 'group_monthly') {
      require('sessionsPerWeek', 'sessions per week is required for a monthly rate');
      require('minutesPerSession', 'session length is required for a monthly rate');
    }
    if (value.rateType === 'single_session') {
      require('minutesPerSession', 'session length is required for a single-session rate');
    }
    if (value.rateType === 'group_monthly') {
      require('perHeadAmount', 'per-head amount is required for a group rate');
      require('groupSizeMax', 'maximum group size is required for a group rate');
    }
  });

/* -------------------------------------------------------------------------
 * Normalisation
 * ---------------------------------------------------------------------- */

function requirePositiveInt(value: number | null | undefined, field: string): number {
  if (value === null || value === undefined) {
    throw new RateNormalisationError(`${field} is required for this rate type`);
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RateNormalisationError(`${field} must be a positive integer, received ${value}`);
  }
  return value;
}

/** Instructional hours a monthly arrangement actually buys. */
export function monthlyHours(sessionsPerWeek: number, minutesPerSession: number): number {
  return sessionsPerWeek * WEEKS_PER_MONTH * (minutesPerSession / 60);
}

/**
 * The comparable number: **what one hour of instruction costs one student**,
 * in paisa, whatever unit the tutor quoted in.
 *
 * Computed on write and stored in `tutor_rates.normalised_hourly_amount`, so
 * that search sorts and rate benchmarks read an indexed integer column rather
 * than computing anything per request (NFR-1, NFR-15, CLAUDE.md §2.8).
 *
 * Note what is *not* included: `travel_charge` is a separate recorded line
 * (FR-31.2) and is deliberately excluded, because it varies by the family's
 * area rather than by the tuition itself and would make two tutors' rates
 * incomparable again.
 *
 * @throws {RateNormalisationError} when the fields a rate type needs are absent
 * — deliberately, rather than guessing.  Silently treating a single-session fee
 * as a monthly one would understate it roughly thirteenfold and corrupt every
 * benchmark computed from it.
 */
export function normaliseHourlyAmount(input: RateInput): number {
  switch (input.rateType) {
    case 'hourly': {
      // Already the comparable unit. `minutesPerSession` describes how the
      // session is scheduled, not how it is priced, so it is not applied.
      return Math.round(input.amount);
    }

    case 'single_session': {
      const minutes = requirePositiveInt(input.minutesPerSession, 'minutesPerSession');
      return Math.round(input.amount / (minutes / 60));
    }

    case 'monthly': {
      const sessions = requirePositiveInt(input.sessionsPerWeek, 'sessionsPerWeek');
      const minutes = requirePositiveInt(input.minutesPerSession, 'minutesPerSession');
      return Math.round(input.amount / monthlyHours(sessions, minutes));
    }

    case 'group_monthly': {
      const sessions = requirePositiveInt(input.sessionsPerWeek, 'sessionsPerWeek');
      const minutes = requirePositiveInt(input.minutesPerSession, 'minutesPerSession');
      // Per head — the figure a family compares against a one-to-one rate.
      const perHead = requirePositiveInt(input.perHeadAmount, 'perHeadAmount');
      return Math.round(perHead / monthlyHours(sessions, minutes));
    }

    default: {
      const exhaustive: never = input.rateType;
      throw new RateNormalisationError(`unknown rate type: ${String(exhaustive)}`);
    }
  }
}

/**
 * Validate and normalise in one step.  This is the only path route handlers
 * should use when writing `tutor_rates`.
 */
export function prepareRate(raw: unknown): RateInput & { normalisedHourlyAmount: number } {
  const parsed = rateInputSchema.parse(raw);
  return { ...parsed, normalisedHourlyAmount: normaliseHourlyAmount(parsed) };
}
