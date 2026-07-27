/**
 * User aggregate — accounts and refresh-token sessions.
 *
 * **There is no function in this module that creates a user for a minor**, and
 * there cannot be: `users` has no owner column, no guardian column and no link
 * to `student_profiles`. A learner under 18 exists only as a
 * `student_profiles` row, which has no `password_hash`, no `email` and no
 * session (SEC-1, decision 2).
 *
 * `passwordHash` is returned only by `findCredentialsByEmail`, whose single
 * caller is the login service. Every other read returns the public shape.
 */

import { and, eq, isNull } from 'drizzle-orm';

import type { AccountRole, AuthenticatedUser } from '../../shared/auth';
import { fromDbTimestamp, newId, nowIso, toDbTimestamp } from '../../shared/db-values';
import { refreshTokens } from '../db/schema/auth';
import { users } from '../db/schema/identity';
import { type Executor, NotFoundError } from './_base';

type StoredUser = typeof users.$inferSelect;

/** The shape that may leave the server. No hash, no token version. */
export function toPublicUser(row: StoredUser): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as AccountRole,
    displayName: row.displayName,
    gender: row.gender,
    preferredLang: row.preferredLang,
    status: row.status,
  };
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  role: AccountRole;
  displayName: string;
  phone?: string | null;
  gender?: 'female' | 'male' | 'other' | null;
  preferredLang?: 'en' | 'ur';
  status?: StoredUser['status'];
}

export async function createUser(
  db: Executor,
  input: CreateUserInput,
): Promise<AuthenticatedUser> {
  const id = newId();
  const now = nowIso();

  await db.insert(users).values({
    id,
    email: input.email,
    passwordHash: input.passwordHash,
    role: input.role,
    displayName: input.displayName,
    phone: input.phone ?? null,
    gender: input.gender ?? null,
    preferredLang: input.preferredLang ?? 'en',
    status: input.status ?? 'active',
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now,
  });

  return getUserOrThrow(db, id);
}

export async function findUserById(
  db: Executor,
  id: string,
): Promise<AuthenticatedUser | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function getUserOrThrow(db: Executor, id: string): Promise<AuthenticatedUser> {
  const found = await findUserById(db, id);
  if (!found) throw new NotFoundError('user', id);
  return found;
}

export async function findUserByEmail(
  db: Executor,
  email: string,
): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ? toPublicUser(rows[0]) : null;
}

/**
 * The **only** read that returns a password hash.
 *
 * Called by `server/services/auth.ts#login` and nowhere else. Kept as a
 * separate, awkwardly-named function so that reaching for it is a deliberate
 * act rather than something that happens by spreading a row.
 */
export async function findCredentialsByEmail(
  db: Executor,
  email: string,
): Promise<{ user: AuthenticatedUser; passwordHash: string; tokenVersion: number } | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    user: toPublicUser(row),
    passwordHash: row.passwordHash,
    tokenVersion: row.tokenVersion,
  };
}

export async function getTokenVersion(db: Executor, userId: string): Promise<number | null> {
  const rows = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.tokenVersion ?? null;
}

/**
 * Invalidate every outstanding token for this account at once.
 *
 * Called on password change, on administrative suspension, and on refresh-token
 * reuse detection.
 */
export async function bumpTokenVersion(db: Executor, userId: string): Promise<void> {
  const current = await getTokenVersion(db, userId);
  if (current === null) throw new NotFoundError('user', userId);

  await db
    .update(users)
    .set({ tokenVersion: current + 1, updatedAt: nowIso() })
    .where(eq(users.id, userId));
}

export async function deleteUser(db: Executor, id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

/* -------------------------------------------------------------------------
 * Refresh-token sessions
 * ---------------------------------------------------------------------- */

export interface StoredRefreshToken {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

export async function insertRefreshToken(
  db: Executor,
  input: { id: string; userId: string; tokenHash: string; familyId: string; expiresAt: Date },
): Promise<void> {
  await db.insert(refreshTokens).values({
    id: input.id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    familyId: input.familyId,
    expiresAt: toDbTimestamp(input.expiresAt),
    createdAt: nowIso(),
  });
}

export async function findRefreshTokenByHash(
  db: Executor,
  tokenHash: string,
): Promise<StoredRefreshToken | null> {
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    expiresAt: fromDbTimestamp(row.expiresAt),
    revokedAt: fromDbTimestamp(row.revokedAt),
    replacedById: row.replacedById,
  };
}

export async function revokeRefreshToken(
  db: Executor,
  id: string,
  at: Date,
  replacedById?: string,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: toDbTimestamp(at), replacedById: replacedById ?? null })
    .where(eq(refreshTokens.id, id));
}

/** Reuse detection: revoke every live token in the family. */
export async function revokeRefreshTokenFamily(
  db: Executor,
  familyId: string,
  at: Date,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: toDbTimestamp(at) })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/** "Log me out everywhere." */
export async function revokeAllRefreshTokensForUser(
  db: Executor,
  userId: string,
  at: Date,
): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: toDbTimestamp(at) })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

export async function countLiveRefreshTokens(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  return rows.length;
}
