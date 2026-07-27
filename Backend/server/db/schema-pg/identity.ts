// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/identity.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identity — specification §9.2.
 *
 * The load-bearing rule in this file is that **a minor has no row in `users`**
 * (SEC-1, SEC-2, OBJ-11, decision 2, CLAUDE.md §2.3).  An under-18 learner
 * exists only as a `student_profiles` record owned by a parent account.  There
 * is no credential, no session, no login path and no contact field for a minor
 * anywhere in the system.
 *
 * This is deliberately expressed as an *absence* rather than a *check*.  A
 * policy that says "do not message a minor directly" can be violated by any
 * future code path that forgets it.  A data model in which no minor has an
 * account, an email address or a password hash cannot be violated by code at
 * all — there is nothing to address a message to.
 *
 * ── Session strategy (documented decision) ─────────────────────────────────
 * Stateless JWT in an httpOnly, SameSite=Lax cookie (FR-1.2).  There is no
 * sessions table and no refresh token, because:
 *
 *  - The deployment target is serverless functions (§12).  A session table
 *    would add a database round trip to every authenticated request, against
 *    a 500 ms search budget (NFR-1) that already has no room in it.
 *  - Revocation is handled by `users.token_version`: the version is embedded in
 *    the token and compared on verification, so bumping it invalidates every
 *    outstanding token for that user at once.  That covers logout-everywhere,
 *    password change, and administrative suspension — the cases that actually
 *    require revocation.
 *  - The residual cost is that a token stays valid until `JWT_EXPIRES_IN` (7d)
 *    for a user whose version was not bumped.  Accepted; the alternative buys
 *    little and costs a query per request.
 *
 * If per-device session listing is ever required, that is the point at which a
 * sessions table earns its place — not before.
 */

import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { nowIso } from '../../../shared/db-values';
import { createdAt, pk, timestampCol } from './_common';
import { LANGS, areas, boards, cities, levels } from './reference';

/** Five roles, §5.1.  A minor is not among them, and never will be. */
export const USER_ROLES = ['parent', 'student', 'tutor', 'organisation', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * `admin` is assignable only by database seed or by an existing administrator
 * (FR-1.5).  Registration may never grant it.
 */
export const SELF_REGISTERABLE_ROLES = ['parent', 'student', 'tutor', 'organisation'] as const;

export const USER_STATUSES = ['pending', 'active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const GENDERS = ['female', 'male', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull().unique(),
    /** Contact number.  Never written to a log (CLAUDE.md §2.2). */
    phone: text('phone'),
    /** bcrypt, cost ≥ 10 (NFR-3).  Never logged, never returned by any API. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    displayName: text('display_name').notNull(),
    gender: text('gender', { enum: GENDERS }),
    preferredLang: text('preferred_lang', { enum: LANGS }).notNull().default('en'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('pending'),
    /**
     * Bumped to invalidate every outstanding token for this user at once.
     * See the session-strategy note at the top of this file.
     */
    tokenVersion: integer('token_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: timestampCol('updated_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex('idx_users_email').on(t.email),
    index('idx_users_role_status').on(t.role, t.status),
  ],
);

/**
 * Parent account detail.
 *
 * `addressEncrypted` is present because it was specified, but note the tension
 * with SEC-3 / FR-2.8: the specification puts a residential address on a
 * *confirmed booking*, encrypted, visible only to the two parties to that
 * booking — precisely so that an address is never sitting on a profile that
 * search or a tutor listing could expose.  Holding one here is a second copy
 * of the most sensitive field in the system.
 *
 * It is therefore nullable, has no index, must never be selected into any
 * response shape that reaches a tutor or a public surface, and must never be
 * logged.  If the booking-level address (§9.5) proves sufficient once §6.8 is
 * built — and it very likely will — this column should be dropped rather than
 * left to accumulate data nothing reads.
 */
export const parentProfiles = pgTable(
  'parent_profiles',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    cityId: text('city_id').references(() => cities.id),
    areaId: text('area_id').references(() => areas.id),
    /** AES ciphertext (NFR-18).  Never plaintext, never logged, never public. */
    addressEncrypted: text('address_encrypted'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_parent_profiles_user').on(t.userId),
    index('idx_parent_profiles_area').on(t.areaId),
  ],
);

/**
 * A learner.
 *
 * Exactly one of `parentUserId` and `selfUserId` is set:
 *
 *  - **`parentUserId` set, `selfUserId` null** — a minor.  No account, no
 *    credentials, no contact details.  Every action on their behalf is taken by
 *    the parent, which is what makes a private adult-to-minor channel
 *    structurally impossible (SEC-2).
 *  - **`selfUserId` set, `parentUserId` null** — an adult student, 18 or over,
 *    acting on their own behalf (§5.1).
 *
 * The rule is enforced in application code by `assertExactlyOneOwner` in
 * `shared/student-profile.ts`, called by every write path.  It is stated here
 * because a reader of the schema must not have to infer it.
 */
export const studentProfiles = pgTable(
  'student_profiles',
  {
    id: pk(),
    /** Set for a minor.  Mutually exclusive with `selfUserId`. */
    parentUserId: text('parent_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Set for an adult student.  Mutually exclusive with `parentUserId`. */
    selfUserId: text('self_user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    gender: text('gender', { enum: GENDERS }),
    levelId: text('level_id').references(() => levels.id),
    boardId: text('board_id').references(() => boards.id),
    schoolName: text('school_name'),
    /**
     * ISO `YYYY-MM-DD`, as text.  Deliberately not a date type and never
     * compared with a database date function — age arithmetic happens in
     * TypeScript so it behaves identically in SQLite and Postgres
     * (CLAUDE.md §2.1).
     */
    dateOfBirth: text('date_of_birth'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_student_profiles_parent').on(t.parentUserId),
    index('idx_student_profiles_self').on(t.selfUserId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ParentProfile = typeof parentProfiles.$inferSelect;
export type StudentProfile = typeof studentProfiles.$inferSelect;
export type NewStudentProfile = typeof studentProfiles.$inferInsert;
