/**
 * The ownership rule for `student_profiles`, enforced in application code.
 *
 * Exactly one of `parentUserId` and `selfUserId` is set:
 *   - `parentUserId` → a minor, who holds no account (SEC-1, CLAUDE.md §2.3);
 *   - `selfUserId`   → an adult student, 18 or over, acting for themselves.
 *
 * Both set would mean a minor with an account.  Neither set would mean a
 * learner nobody is responsible for.  Both are safety failures, not data
 * hygiene issues, so this throws rather than coercing.
 *
 * A database CHECK constraint would be a reasonable second line of defence and
 * ports cleanly to Postgres; it is not the primary one, because the guard must
 * fail at the point of the mistake with an intelligible message, not as a
 * constraint violation surfacing from three layers down.
 */

import { z } from 'zod';

/** Under this age, a learner may not hold an account.  §5.1, SEC-1. */
export const MINIMUM_ACCOUNT_AGE_YEARS = 18;

export class StudentProfileOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudentProfileOwnershipError';
  }
}

export interface StudentProfileOwnership {
  parentUserId?: string | null;
  selfUserId?: string | null;
}

/**
 * Call before every `student_profiles` insert or update.
 *
 * @throws {StudentProfileOwnershipError} if zero or both owners are set.
 */
export function assertExactlyOneOwner(input: StudentProfileOwnership): void {
  const hasParent = typeof input.parentUserId === 'string' && input.parentUserId.length > 0;
  const hasSelf = typeof input.selfUserId === 'string' && input.selfUserId.length > 0;

  if (hasParent && hasSelf) {
    throw new StudentProfileOwnershipError(
      'A student profile may not have both a parent owner and a self owner. ' +
        'A minor is owned by a parent and holds no account; an adult student owns ' +
        'their own profile (SEC-1).',
    );
  }
  if (!hasParent && !hasSelf) {
    throw new StudentProfileOwnershipError(
      'A student profile must have exactly one owner: parentUserId for a minor, ' +
        'or selfUserId for an adult student (SEC-1).',
    );
  }
}

/** True when the profile belongs to a minor and is therefore parent-mediated. */
export function isParentOwned(input: StudentProfileOwnership): boolean {
  assertExactlyOneOwner(input);
  return typeof input.parentUserId === 'string' && input.parentUserId.length > 0;
}

/**
 * Whole years between `dateOfBirth` (ISO `YYYY-MM-DD`) and `asOf`.
 *
 * Computed here rather than in SQL so it behaves identically in SQLite and
 * Postgres (CLAUDE.md §2.1).  `asOf` is a parameter, not `new Date()` inside
 * the function, so the result is testable and reproducible.
 */
export function ageInYears(dateOfBirth: string, asOf: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  if (!y || !m || !d) throw new RangeError(`invalid date of birth: "${dateOfBirth}"`);

  let age = asOf.getUTCFullYear() - y;
  const monthDiff = asOf.getUTCMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * A learner under 18 must be parent-owned.  Called wherever a date of birth is
 * supplied alongside an ownership claim.
 */
export function assertMinorIsParentOwned(
  input: StudentProfileOwnership & { dateOfBirth?: string | null },
  asOf: Date,
): void {
  assertExactlyOneOwner(input);
  if (!input.dateOfBirth) return;

  const age = ageInYears(input.dateOfBirth, asOf);
  if (age < MINIMUM_ACCOUNT_AGE_YEARS && !isParentOwned(input)) {
    throw new StudentProfileOwnershipError(
      `A learner aged ${age} may not hold an account. Under-18 learners exist only ` +
        'as a student profile owned by a parent account (SEC-1, OBJ-11).',
    );
  }
}

export const studentProfileOwnershipSchema = z
  .object({
    parentUserId: z.string().min(1).nullable().optional(),
    selfUserId: z.string().min(1).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    try {
      assertExactlyOneOwner(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'invalid student profile ownership',
      });
    }
  });

/* =========================================================================
 * The API contract — §6.2, SEC-1
 * ====================================================================== */

/**
 * Adding a learner.
 *
 * **This never creates an account.** It creates a `student_profiles` row, and
 * ownership is decided by the caller's role rather than by anything in this
 * body: a parent's request produces a parent-owned profile, an adult student's
 * produces a self-owned one. There is deliberately no `parentUserId` or
 * `selfUserId` field here — a request body that could name its own owner would
 * be a request body that could claim a child was an adult, and §2.3 makes the
 * absence of that path structural rather than a check.
 *
 * `dateOfBirth` is optional because a parent adding a child under their own
 * account has already established that the learner is a minor by the route
 * they took. Where it is supplied, `assertMinorIsParentOwned` still runs.
 */
export const createStudentProfileSchema = z.object({
  /** Any script, stored unchanged, never translated (§2.10). */
  name: z.string().trim().min(1).max(120),
  gender: z.enum(['female', 'male', 'other']).optional(),
  levelId: z.string().min(1).optional(),
  boardId: z.string().min(1).optional(),
  schoolName: z.string().trim().max(200).optional(),
  /** ISO `YYYY-MM-DD`. Text, never a date type (§2.1). */
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use the format YYYY-MM-DD')
    .optional(),
});

export type CreateStudentProfileInput = z.infer<typeof createStudentProfileSchema>;

export const updateStudentProfileSchema = createStudentProfileSchema.partial();
export type UpdateStudentProfileInput = z.infer<typeof updateStudentProfileSchema>;
