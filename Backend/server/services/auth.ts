/**
 * Authentication service — §6.1, FR-1.1 to FR-1.6, NFR-3.
 *
 * ── Token design ───────────────────────────────────────────────────────────
 * A short-lived **access token** (15 minutes) in an httpOnly cookie, plus a
 * longer-lived **refresh token** (7 days) that rotates on every use.
 *
 *  · The access token is a stateless JWT. Verifying it touches no database, so
 *    an authenticated request costs nothing extra — which is what keeps the
 *    500 ms search budget reachable on a serverless host (NFR-1).
 *  · The refresh token is opaque random bytes, stored as a SHA-256 hash, and
 *    consulted only at `POST /api/auth/refresh` — about once per 15 minutes,
 *    not once per request.
 *  · Rotation means the presented refresh token is revoked and replaced. If a
 *    **revoked** token is presented, the whole family is revoked and
 *    `tokenVersion` is bumped: either the client replayed an old token or one
 *    was stolen, and the server cannot tell which.
 *
 * Revocation of an access token takes effect within one access-token lifetime.
 * That is the cost of statelessness and it is bounded at 15 minutes; the
 * alternative is a database read on every request.
 *
 * ── Never ──────────────────────────────────────────────────────────────────
 * No token in `localStorage`, no token in a URL, no token in a log line
 * (CLAUDE.md §2.2). Cookies are `httpOnly`, `sameSite=lax`, and `secure` in
 * production.
 */

import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import {
  type AccountRole,
  type AuthenticatedUser,
  type LoginInput,
  type RegisterInput,
  isRegisterableRole,
} from '../../shared/auth';
import { newId } from '../../shared/db-values';
import { MINIMUM_ACCOUNT_AGE_YEARS, ageInYears } from '../../shared/student-profile';
import type { Executor } from '../repositories/_base';
import {
  bumpTokenVersion,
  createUser,
  findCredentialsByEmail,
  findRefreshTokenByHash,
  findUserByEmail,
  getTokenVersion,
  insertRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  revokeRefreshTokenFamily,
} from '../repositories/users';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ACCESS_COOKIE = 'ustaad_at';
export const REFRESH_COOKIE = 'ustaad_rt';

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '' || secret.startsWith('REPLACE_')) {
    throw new AuthError(
      500,
      'jwt_secret_missing',
      'JWT_SECRET is not configured. The application will not issue sessions without one.',
    );
  }
  return secret;
}

function bcryptCost(): number {
  const cost = Number(process.env.BCRYPT_COST ?? 12);
  // NFR-3 says 10 or above; the brief says 12. Below 10 is refused outright
  // rather than quietly accepted.
  if (!Number.isInteger(cost) || cost < 10 || cost > 15) {
    throw new AuthError(
      500,
      'bcrypt_cost_invalid',
      `BCRYPT_COST must be an integer between 10 and 15 (NFR-3); found ${cost}`,
    );
  }
  return cost;
}

/* -------------------------------------------------------------------------
 * Passwords
 * ---------------------------------------------------------------------- */

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, bcryptCost());
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * A bcrypt hash of a fixed string, used to spend comparable time when the
 * email does not exist.
 *
 * Without it, a missing account returns in microseconds while a wrong password
 * takes ~250 ms, and that difference enumerates the user list. Computed lazily
 * and once.
 */
let decoyHash: string | null = null;
async function burnComparableTime(candidate: string): Promise<void> {
  decoyHash ??= await bcrypt.hash('a-password-that-belongs-to-nobody', bcryptCost());
  await bcrypt.compare(candidate, decoyHash);
}

/* -------------------------------------------------------------------------
 * Tokens
 * ---------------------------------------------------------------------- */

export interface AccessTokenClaims {
  sub: string;
  role: AccountRole;
  /** Token version at issue. Checked on refresh, not on every request. */
  tv: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, jwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'ustaad.com',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, jwtSecret(), { issuer: 'ustaad.com' });
    if (typeof payload === 'string') throw new Error('unexpected token payload');

    const { sub, role, tv } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof role !== 'string' || typeof tv !== 'number') {
      throw new Error('token is missing required claims');
    }
    return { sub, role: role as AccountRole, tv };
  } catch {
    // Never forward the library's message: it distinguishes expired from
    // malformed from wrong-signature, which is more than a caller needs.
    throw new AuthError(401, 'invalid_token', 'Your session is not valid. Please log in again.');
  }
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

async function issueSession(
  db: Executor,
  user: AuthenticatedUser,
  tokenVersion: number,
  familyId: string,
  now: Date,
): Promise<IssuedSession> {
  const refreshToken = randomBytes(32).toString('base64url');
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await insertRefreshToken(db, {
    id: newId(),
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiresAt,
  });

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role, tv: tokenVersion }),
    refreshToken,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
    refreshExpiresAt,
  };
}

/* -------------------------------------------------------------------------
 * Register
 * ---------------------------------------------------------------------- */

export interface RegisterResult {
  user: AuthenticatedUser;
  session: IssuedSession;
}

/**
 * Create an account.
 *
 * Three refusals here are structural rather than cosmetic:
 *
 *  1. **`admin` is unreachable.** The parameter type is `RegisterInput`, whose
 *     `role` is `RegisterableRole`, which does not include it (FR-1.5). The
 *     runtime guard below exists for callers that bypass the Zod schema.
 *  2. **A learner under 18 cannot obtain credentials.** Registering as
 *     `student` requires a date of birth and it is re-checked here against an
 *     injected clock, not only in the schema (SEC-1, OBJ-11).
 *  3. **There is no parameter for a guardian, a parent, or a student profile.**
 *     An account created here belongs to the person authenticating and to
 *     nobody else. A minor has no row in this table at all.
 */
export async function register(
  db: Executor,
  input: RegisterInput,
  now: Date = new Date(),
): Promise<RegisterResult> {
  if (!isRegisterableRole(input.role)) {
    throw new AuthError(
      403,
      'role_not_registerable',
      'That role cannot be chosen at registration. An administrator account is created by ' +
        'database seed or promoted by an existing administrator (FR-1.5).',
    );
  }

  if (input.role === 'student') {
    if (!input.dateOfBirth) {
      throw new AuthError(
        400,
        'date_of_birth_required',
        'A date of birth is required to register as a student.',
      );
    }
    if (ageInYears(input.dateOfBirth, now) < MINIMUM_ACCOUNT_AGE_YEARS) {
      throw new AuthError(
        403,
        'minor_may_not_hold_account',
        `A learner under ${MINIMUM_ACCOUNT_AGE_YEARS} may not hold an account on Ustaad.com. ` +
          'Ask a parent to register and add the learner as a student profile on their ' +
          'account (SEC-1, OBJ-11).',
      );
    }
  }

  const existing = await findUserByEmail(db, input.email);
  if (existing) {
    throw new AuthError(409, 'email_taken', 'An account already exists for that email address.');
  }

  const user = await createUser(db, {
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    displayName: input.displayName,
    phone: input.phone ?? null,
    gender: input.gender ?? null,
    preferredLang: input.preferredLang,
    status: 'active',
  });

  const session = await issueSession(db, user, 1, newId(), now);
  return { user, session };
}

/* -------------------------------------------------------------------------
 * Login
 * ---------------------------------------------------------------------- */

export async function login(
  db: Executor,
  input: LoginInput,
  now: Date = new Date(),
): Promise<RegisterResult> {
  const found = await findCredentialsByEmail(db, input.email);

  if (!found) {
    // Spend comparable time so a missing account is indistinguishable from a
    // wrong password, then fail identically.
    await burnComparableTime(input.password);
    throw new AuthError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }

  const ok = await verifyPassword(input.password, found.passwordHash);
  if (!ok) {
    throw new AuthError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }

  if (found.user.status === 'suspended' || found.user.status === 'deactivated') {
    throw new AuthError(
      403,
      'account_not_active',
      'This account is not active. Contact Ustaad.com if you believe that is a mistake.',
    );
  }

  const session = await issueSession(db, found.user, found.tokenVersion, newId(), now);
  return { user: found.user, session };
}

/* -------------------------------------------------------------------------
 * Refresh (rotation)
 * ---------------------------------------------------------------------- */

export async function refresh(
  db: Executor,
  presentedToken: string,
  now: Date = new Date(),
): Promise<RegisterResult> {
  const stored = await findRefreshTokenByHash(db, hashToken(presentedToken));

  if (!stored) {
    throw new AuthError(401, 'invalid_refresh', 'Your session has ended. Please log in again.');
  }

  if (stored.revokedAt !== null) {
    // Reuse of a rotated token. Either the client replayed an old one or it was
    // stolen; the server cannot tell, so it assumes the worse case and ends
    // every session in the family.
    await revokeRefreshTokenFamily(db, stored.familyId, now);
    await bumpTokenVersion(db, stored.userId);
    throw new AuthError(
      401,
      'refresh_token_reused',
      'This session was ended for security reasons. Please log in again.',
    );
  }

  if (stored.expiresAt.getTime() <= now.getTime()) {
    await revokeRefreshToken(db, stored.id, now);
    throw new AuthError(401, 'refresh_expired', 'Your session has expired. Please log in again.');
  }

  const tokenVersion = await getTokenVersion(db, stored.userId);
  if (tokenVersion === null) {
    throw new AuthError(401, 'invalid_refresh', 'Your session has ended. Please log in again.');
  }

  const { getUserOrThrow } = await import('../repositories/users');
  const user = await getUserOrThrow(db, stored.userId);

  if (user.status === 'suspended' || user.status === 'deactivated') {
    await revokeRefreshTokenFamily(db, stored.familyId, now);
    throw new AuthError(403, 'account_not_active', 'This account is not active.');
  }

  // Rotate: the presented token dies, its successor is born in the same family.
  const session = await issueSession(db, user, tokenVersion, stored.familyId, now);
  await revokeRefreshToken(db, stored.id, now);

  return { user, session };
}

/* -------------------------------------------------------------------------
 * Logout
 * ---------------------------------------------------------------------- */

/** Ends this session. The access token remains valid for its residual life. */
export async function logout(
  db: Executor,
  presentedToken: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!presentedToken) return;
  const stored = await findRefreshTokenByHash(db, hashToken(presentedToken));
  if (!stored) return;
  await revokeRefreshTokenFamily(db, stored.familyId, now);
}

/** Ends every session for the account, everywhere. */
export async function logoutEverywhere(
  db: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await revokeAllRefreshTokensForUser(db, userId, now);
  await bumpTokenVersion(db, userId);
}
