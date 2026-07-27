/**
 * Authentication contracts — specification §5.1, §6.1.
 *
 * These Zod schemas are the single definition of what a registration or a login
 * may contain, used by the client for user experience and by the server as the
 * actual gate (NFR-6, NFR-7).  The client copy is never trusted.
 *
 * ── The rule this file exists to make structural ───────────────────────────
 * **A minor holds no account** (SEC-1, OBJ-11, decision 2).  There is no role
 * for a learner under 18, and `REGISTERABLE_ROLES` below is the complete set a
 * registration request may ask for.  `admin` is absent by construction, not by
 * a check that could be forgotten (FR-1.5).
 *
 * The `student` role means an *adult* student, 18 or over, acting on their own
 * behalf (§5.1).  A registration claiming that role must supply a date of birth
 * and it is verified here and again in the service.  A learner under 18 exists
 * only as a `student_profiles` row owned by a parent — a table with no
 * password, no email and no session.
 */

import { z } from 'zod';

import { MINIMUM_ACCOUNT_AGE_YEARS, ageInYears } from './student-profile';

/**
 * The complete set of roles a registration may request.
 *
 * `admin` is **not** here and must never be added: an administrator is created
 * by database seed or promoted by an existing administrator (FR-1.5).
 * A minor is not here either, and has no role anywhere in the system.
 */
export const REGISTERABLE_ROLES = ['parent', 'student', 'tutor', 'organisation'] as const;
export type RegisterableRole = (typeof REGISTERABLE_ROLES)[number];

/** Every role that can hold an account, including the seeded administrator. */
export const ACCOUNT_ROLES = [...REGISTERABLE_ROLES, 'admin'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function isRegisterableRole(value: unknown): value is RegisterableRole {
  return (REGISTERABLE_ROLES as readonly unknown[]).includes(value);
}

/* -------------------------------------------------------------------------
 * Password policy
 * ---------------------------------------------------------------------- */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Length, not composition rules.
 *
 * Character-class requirements push people towards `Password1!` and are worse
 * than a longer minimum. The maximum exists because bcrypt silently truncates
 * at 72 bytes — a password longer than that would appear to be accepted while
 * only its first 72 bytes were ever checked, which is a real (if quiet)
 * weakness. Rejecting is honest; truncating is not.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
    message: 'password must be at most 72 bytes; bcrypt ignores anything beyond that',
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('a valid email address is required')
  .max(254);

/** Pakistani mobile numbers, loosely: digits, spaces, dashes, optional +92. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s-]{7,17}$/, 'a valid contact number is required');

/** ISO `YYYY-MM-DD`. Compared in TypeScript, never by a database date function. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD form');

/* -------------------------------------------------------------------------
 * Register
 * ---------------------------------------------------------------------- */

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    /**
     * Restricted to `REGISTERABLE_ROLES`. A request naming `admin` fails
     * schema validation before any handler runs (FR-1.5).
     */
    role: z.enum(REGISTERABLE_ROLES),
    displayName: z.string().trim().min(2).max(120),
    phone: phoneSchema.optional(),
    gender: z.enum(['female', 'male', 'other']).optional(),
    preferredLang: z.enum(['en', 'ur']).default('en'),
    /**
     * Required when `role` is `student`, because that role means an adult
     * student acting for themselves and the platform must establish that they
     * are 18 or over before issuing credentials.
     */
    dateOfBirth: isoDateSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role !== 'student') return;

    if (!value.dateOfBirth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message:
          'a date of birth is required to register as a student, because only learners aged ' +
          `${MINIMUM_ACCOUNT_AGE_YEARS} or over may hold an account (SEC-1)`,
      });
      return;
    }

    // `asOf` is the schema's evaluation moment. The service re-checks with an
    // injected clock so the rule is testable and reproducible.
    if (ageInYears(value.dateOfBirth, new Date()) < MINIMUM_ACCOUNT_AGE_YEARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message:
          `a learner under ${MINIMUM_ACCOUNT_AGE_YEARS} may not hold an account. ` +
          'Ask a parent to register and add the learner as a student profile (SEC-1, OBJ-11)',
      });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;

/* -------------------------------------------------------------------------
 * Login
 * ---------------------------------------------------------------------- */

export const loginSchema = z.object({
  email: emailSchema,
  // No length bounds: a login must not reveal the password policy, and a wrong
  // password of any shape gets the same generic failure.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;

/* -------------------------------------------------------------------------
 * The public shape of an authenticated user
 * ---------------------------------------------------------------------- */

/**
 * What `GET /api/auth/me` returns.
 *
 * Note what is absent and must stay absent: `passwordHash`, `tokenVersion`, and
 * any address field. Declaring the shape here rather than spreading a database
 * row is what keeps that true (CLAUDE.md §2.2).
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AccountRole;
  displayName: string;
  gender: 'female' | 'male' | 'other' | null;
  preferredLang: 'en' | 'ur';
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
}
