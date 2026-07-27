/**
 * Authentication and authorisation middleware — NFR-6.
 *
 * Every mutating endpoint checks **role and resource ownership server-side**.
 * A client-side guard is a convenience for the interface and is never relied
 * upon; a route that omits `requireRole` or an ownership check is unprotected
 * regardless of what the front end renders.
 *
 * `requireOwnership` is the one that matters most in practice. Role alone says
 * "you are a parent"; it does not say "you are *this student's* parent". On a
 * platform holding minors' names, schools and session histories, the second
 * question is the one that keeps one family's data away from another.
 */

import type { NextFunction, Request, Response } from 'express';

import type { AccountRole } from '../../shared/auth';
import type { Executor } from '../repositories/_base';
import { ACCESS_COOKIE, verifyAccessToken } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticate`. Absent on an anonymous request. */
    auth?: { userId: string; role: AccountRole; tokenVersion: number };
    /** The Drizzle handle for this request, injected by the app factory. */
    db: Executor;
  }
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

/**
 * Reads the access token from the httpOnly cookie and attaches `req.auth`.
 *
 * **The cookie is the only accepted carrier.** There is no `Authorization`
 * header path and no query-parameter path: a token in a URL ends up in browser
 * history, in a referrer header, and in access logs, and this codebase must
 * never write one to a log (CLAUDE.md §2.2).
 *
 * Anonymous requests pass through with `req.auth` unset — browsing and search
 * require no login (FR-1.6). It is `requireAuth` that refuses them.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  if (!token) return next();

  try {
    const claims = verifyAccessToken(token);
    req.auth = { userId: claims.sub, role: claims.role, tokenVersion: claims.tv };
  } catch {
    // A malformed or expired token is treated as anonymous rather than as an
    // error, so the client can retry through /api/auth/refresh.
    req.auth = undefined;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    fail(res, 401, 'authentication_required', 'You must be logged in to do that.');
    return;
  }
  next();
}

/**
 * `requireRole('admin')`, `requireRole('tutor')`, `requireRole('parent', 'student')`.
 *
 * Roles are checked against the signed token, never against a body field.
 */
export function requireRole(...roles: AccountRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      fail(res, 401, 'authentication_required', 'You must be logged in to do that.');
      return;
    }
    if (!roles.includes(req.auth.role)) {
      // Deliberately does not say which role is required — that is information
      // about the system's shape that an unauthorised caller has not earned.
      fail(res, 403, 'forbidden', 'You do not have permission to do that.');
      return;
    }
    next();
  };
}

/* -------------------------------------------------------------------------
 * Ownership
 * ---------------------------------------------------------------------- */

/**
 * Resolves who owns the resource named by the request.
 *
 * Returns the set of user ids permitted to act, or `null` when the resource
 * does not exist.
 */
export type OwnerResolver = (
  req: Request,
) => Promise<{ ownerUserIds: string[] } | null>;

export interface OwnershipOptions {
  /** Roles that bypass the check. Empty by default — administrators included. */
  allowRoles?: AccountRole[];
  /** Named in the error, e.g. "booking". */
  entity?: string;
}

/**
 * Proves the caller owns the resource.
 *
 * A missing resource and a resource belonging to somebody else both return
 * **404**, not 403. Returning 403 for one and 404 for the other turns the
 * endpoint into an existence oracle: a parent could enumerate other families'
 * booking ids by watching which status code comes back. The caller who is
 * entitled to the row is the only one who learns that it exists.
 *
 * Administrators are not exempt by default. Where an administrator genuinely
 * needs access — a dispute, a safety concern — the route says so explicitly
 * with `allowRoles: ['admin']`, and the sensitive paths write an audit entry
 * (SEC-13).
 */
export function requireOwnership(resolve: OwnerResolver, options: OwnershipOptions = {}) {
  const entity = options.entity ?? 'resource';
  const allowRoles = options.allowRoles ?? [];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      fail(res, 401, 'authentication_required', 'You must be logged in to do that.');
      return;
    }

    if (allowRoles.includes(req.auth.role)) {
      next();
      return;
    }

    try {
      const owned = await resolve(req);

      if (!owned || !owned.ownerUserIds.includes(req.auth.userId)) {
        fail(res, 404, 'not_found', `No such ${entity}.`);
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/* -------------------------------------------------------------------------
 * Error translation
 * ---------------------------------------------------------------------- */

/**
 * A deliberate, user-facing refusal: an HTTP status, a stable code and a
 * message written for a person.
 */
interface PublicError {
  status: number;
  code: string;
  message: string;
}

function isPublicError(error: unknown): error is PublicError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 600 &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

/**
 * Turns a deliberate refusal into its status and code, and everything else into
 * a bare 500.
 *
 * The generic branch deliberately does not echo the error message. An
 * unexpected failure may carry a query fragment, a file path, or a value from a
 * row, and none of those belong in a response.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Any service error that declares an HTTP status and a stable code is a
  // deliberate, user-facing refusal — AuthError, OnboardingError, and whatever
  // the next module adds. Matching on the shape rather than on a list of
  // classes means a new service does not silently return 500 because someone
  // forgot to extend this function.
  if (isPublicError(error)) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Log the id, never the payload (CLAUDE.md §2.2).
  console.error('[unhandled]', error instanceof Error ? error.message : 'non-error thrown');
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong. Please try again.' },
  });
}
