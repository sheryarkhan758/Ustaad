/**
 * Student profiles — §6.2, SEC-1, CLAUDE.md §2.3.
 *
 * ── A learner is a row, not an account ─────────────────────────────────────
 * A minor exists here and **nowhere else**. There is no `users` row, no
 * credential, no session, no login path and no invitation path for a learner
 * under 18 — the absence of the row is the enforcement, and
 * `server/child-safety.test.ts` asserts that structurally.
 *
 * Ownership is exactly one of `parentUserId` (a minor) or `selfUserId` (an
 * adult acting for themselves), checked by `assertExactlyOneOwner` before every
 * write. Both set would be a minor with an account; neither would be a learner
 * nobody is responsible for. Both are safety failures, so the guard throws
 * rather than coercing.
 *
 * ── Reads are scoped by owner, and a stranger's profile is a 404 ───────────
 * `listStudentProfilesForUser` filters on the caller's own id. `findOwnedById`
 * returns `null` for a profile belonging to somebody else — deliberately
 * indistinguishable from one that does not exist, so the endpoint is never an
 * existence oracle over children's ids. The progress ledger already takes this
 * position; this module takes the same one.
 */

import { and, eq, or } from 'drizzle-orm';

import {
  assertExactlyOneOwner,
  assertMinorIsParentOwned,
  type CreateStudentProfileInput,
  type UpdateStudentProfileInput,
} from '../../shared/student-profile';
import { newId } from '../../shared/db-values';
import { studentProfiles } from '../db/schema/identity';
import type { Executor } from './_base';

export interface StudentProfileRecord {
  id: string;
  name: string;
  gender: 'female' | 'male' | 'other' | null;
  levelId: string | null;
  boardId: string | null;
  schoolName: string | null;
  dateOfBirth: string | null;
  /** True when this learner is parent-mediated — i.e. holds no account. */
  parentOwned: boolean;
  createdAt: string;
}

type StoredStudentProfile = typeof studentProfiles.$inferSelect;

function toDomain(row: StoredStudentProfile): StudentProfileRecord {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender ?? null,
    levelId: row.levelId ?? null,
    boardId: row.boardId ?? null,
    schoolName: row.schoolName ?? null,
    dateOfBirth: row.dateOfBirth ?? null,
    parentOwned: row.parentUserId !== null,
    createdAt: row.createdAt,
  };
}

/** Every learner this account is responsible for, as parent or as themselves. */
export async function listStudentProfilesForUser(
  db: Executor,
  userId: string,
): Promise<StudentProfileRecord[]> {
  const rows = await db
    .select()
    .from(studentProfiles)
    .where(or(eq(studentProfiles.parentUserId, userId), eq(studentProfiles.selfUserId, userId)));

  return rows.map(toDomain);
}

/**
 * One learner, only if this account owns them.
 *
 * `null` for both "no such profile" and "somebody else's profile". See the
 * module header: the two must not be distinguishable.
 */
export async function findOwnedStudentProfile(
  db: Executor,
  id: string,
  userId: string,
): Promise<StudentProfileRecord | null> {
  const rows = await db
    .select()
    .from(studentProfiles)
    .where(
      and(
        eq(studentProfiles.id, id),
        or(eq(studentProfiles.parentUserId, userId), eq(studentProfiles.selfUserId, userId)),
      ),
    )
    .limit(1);

  return rows[0] ? toDomain(rows[0]) : null;
}

export interface CreateStudentProfileArgs extends CreateStudentProfileInput {
  /** The caller. Their **role** decides ownership — never the request body. */
  ownerUserId: string;
  ownerRole: 'parent' | 'student';
}

/**
 * Create a learner.
 *
 * A parent's request produces a parent-owned profile; an adult student's
 * produces a self-owned one. The caller cannot express anything else, because
 * `createStudentProfileSchema` has no ownership field — which is what makes
 * "a parent registering a child as an adult" unrepresentable rather than
 * merely refused.
 */
export async function createStudentProfile(
  db: Executor,
  input: CreateStudentProfileArgs,
  now: Date,
): Promise<StudentProfileRecord> {
  const ownership =
    input.ownerRole === 'parent'
      ? { parentUserId: input.ownerUserId, selfUserId: null }
      : { parentUserId: null, selfUserId: input.ownerUserId };

  assertExactlyOneOwner(ownership);
  // A supplied date of birth under 18 on a self-owned profile throws here —
  // an adult student cannot enter a child's date of birth and proceed.
  assertMinorIsParentOwned({ ...ownership, dateOfBirth: input.dateOfBirth ?? null }, now);

  const id = newId();

  await db.insert(studentProfiles).values({
    id,
    parentUserId: ownership.parentUserId,
    selfUserId: ownership.selfUserId,
    name: input.name,
    gender: input.gender ?? null,
    levelId: input.levelId ?? null,
    boardId: input.boardId ?? null,
    schoolName: input.schoolName ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
  });

  // No `.returning()` anywhere in this codebase — the id is known before the
  // insert, so write then select (§2.1).
  const [row] = await db.select().from(studentProfiles).where(eq(studentProfiles.id, id)).limit(1);
  return toDomain(row!);
}

/**
 * Amend a learner's details.
 *
 * Ownership columns are not in the patch and cannot be reached from here: a
 * profile never changes hands, because the only shapes that would need it —
 * handing a child to another account, or a minor "graduating" into their own
 * login — are exactly the two §2.3 forbids.
 */
export async function updateStudentProfile(
  db: Executor,
  id: string,
  patch: UpdateStudentProfileInput,
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.gender !== undefined) values.gender = patch.gender;
  if (patch.levelId !== undefined) values.levelId = patch.levelId;
  if (patch.boardId !== undefined) values.boardId = patch.boardId;
  if (patch.schoolName !== undefined) values.schoolName = patch.schoolName;
  if (patch.dateOfBirth !== undefined) values.dateOfBirth = patch.dateOfBirth;

  if (Object.keys(values).length === 0) return;

  await db.update(studentProfiles).set(values).where(eq(studentProfiles.id, id));
}
