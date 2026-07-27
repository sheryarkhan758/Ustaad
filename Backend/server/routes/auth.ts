/**
 * Authentication routes — §6.1.
 *
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/refresh
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *
 * Handlers stay thin: parse with a Zod schema from `/shared`, call a service,
 * set cookies, respond (CLAUDE.md §5.4). No SQL, no bcrypt, no `jwt` here.
 *
 * **There is no route in this file, or anywhere, that issues credentials to a
 * minor.** Registration accepts only `REGISTERABLE_ROLES`, and a learner under
 * 18 has no role in that set and no row in `users` to authenticate against
 * (SEC-1, decision 2).
 */

import { Router, type CookieOptions, type Request, type Response } from 'express';

import { loginSchema, registerSchema } from '../../shared/auth';
import { requireAuth } from '../middleware/auth';
import { createAuthLimiter } from '../middleware/rate-limit';
import { findUserById } from '../repositories/users';
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  AuthError,
  type IssuedSession,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_SECONDS,
  login,
  logout,
  refresh,
  register,
} from '../services/auth';

/**
 * `httpOnly` so no script can read it. `sameSite=lax` so it is not sent on a
 * cross-site POST, which is the CSRF case that matters here, while still
 * surviving an ordinary top-level navigation back to the site. `secure` in
 * production, off in local http development because the browser would
 * otherwise discard the cookie entirely.
 */
function cookieOptions(maxAgeSeconds: number, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path,
    maxAge: maxAgeSeconds * 1000,
    ...(process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost'
      ? { domain: process.env.COOKIE_DOMAIN }
      : {}),
  };
}

/**
 * The refresh cookie is scoped to `/api/auth`, so it is not attached to any
 * other request. A long-lived credential should travel as rarely as possible.
 */
const REFRESH_PATH = '/api/auth';

function setSessionCookies(res: Response, session: IssuedSession): void {
  res.cookie(ACCESS_COOKIE, session.accessToken, cookieOptions(ACCESS_TOKEN_TTL_SECONDS, '/'));
  res.cookie(
    REFRESH_COOKIE,
    session.refreshToken,
    cookieOptions(REFRESH_TOKEN_TTL_SECONDS, REFRESH_PATH),
  );
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
}

function readCookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[name];
}

export function createAuthRouter(): Router {
  const router = Router();
  const authLimiter = createAuthLimiter();

  /* --- Register ---------------------------------------------------------- */
  router.post('/register', authLimiter, async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'validation_failed',
            message: 'Please check the details you entered.',
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        });
        return;
      }

      const { user, session } = await register(req.db, parsed.data);
      setSessionCookies(res, session);
      res.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  /* --- Login ------------------------------------------------------------- */
  router.post('/login', authLimiter, async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        // Same shape and status as a wrong password: a validation error here
        // must not tell an attacker that the email format was the problem.
        res
          .status(401)
          .json({ error: { code: 'invalid_credentials', message: 'Email or password is incorrect.' } });
        return;
      }

      const { user, session } = await login(req.db, parsed.data);
      setSessionCookies(res, session);
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  /* --- Refresh (rotation) ------------------------------------------------ */
  router.post('/refresh', async (req, res, next) => {
    try {
      const presented = readCookie(req, REFRESH_COOKIE);
      if (!presented) {
        throw new AuthError(401, 'invalid_refresh', 'Your session has ended. Please log in again.');
      }

      const { user, session } = await refresh(req.db, presented);
      setSessionCookies(res, session);
      res.status(200).json({ user });
    } catch (error) {
      // A refused refresh always clears the cookies, so a client holding a
      // revoked token cannot keep replaying it.
      clearSessionCookies(res);
      next(error);
    }
  });

  /* --- Logout ------------------------------------------------------------ */
  router.post('/logout', async (req, res, next) => {
    try {
      await logout(req.db, readCookie(req, REFRESH_COOKIE));
      clearSessionCookies(res);
      // 204 whether or not there was a session: logging out is idempotent, and
      // the response must not reveal whether the presented token was real.
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  /* --- Me ---------------------------------------------------------------- */
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      const user = await findUserById(req.db, req.auth!.userId);
      if (!user) {
        clearSessionCookies(res);
        throw new AuthError(401, 'invalid_token', 'Your session is not valid. Please log in again.');
      }
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
