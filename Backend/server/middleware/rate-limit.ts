/**
 * Rate limiting for the credential endpoints.
 *
 * Login and registration are the two routes where an attacker gets unlimited
 * free attempts at something valuable, so they are limited far harder than the
 * general API. Bcrypt at cost 12 also makes each attempt expensive for *us* —
 * roughly 250 ms of CPU — so an unlimited login endpoint is a denial-of-service
 * surface as much as a credential-stuffing one.
 *
 * Limits are disabled under `NODE_ENV=test` because an integration suite makes
 * dozens of legitimate login attempts in seconds. `authLimiter` is exercised
 * directly by its own test instead, with the limit forced on.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

const isTest = process.env.NODE_ENV === 'test';

function limitResponse(_req: Request, res: Response): void {
  res.status(429).json({
    error: {
      code: 'too_many_requests',
      message: 'Too many attempts. Please wait a few minutes and try again.',
    },
  });
}

/**
 * The client address, on a platform where Express cannot work it out itself.
 *
 * **This exists because of a real deployment bug.** Behind a Netlify Function
 * the request reaches Express through a Lambda-shaped event rather than a
 * socket, so `req.ip` is `undefined` and express-rate-limit throws
 * `ERR_ERL_UNDEFINED_IP_ADDRESS`. Every limiter in this file would have been
 * broken in production while passing every local test — the login endpoint,
 * which is the one that most needs limiting, included.
 *
 * The order below is deliberate:
 *
 *  1. `x-nf-client-connection-ip` — set by Netlify's edge from the real TCP
 *     connection. A caller cannot forge it; the edge overwrites it.
 *  2. `x-forwarded-for`, first hop — the standard proxy header. `trust proxy`
 *     is set to 1 in the app factory, so Express would use this too.
 *  3. `req.ip` — the ordinary path, used when running as a real server.
 *
 * The final fallback is the literal `'unknown'`, and that is a deliberate
 * trade: every unidentifiable caller shares one bucket, so a platform change
 * that removed all three headers would rate-limit those callers collectively
 * rather than not at all. Failing closed is the right direction for a control
 * that protects a credential endpoint.
 */
export function clientKey(req: Request): string {
  const netlify = req.headers['x-nf-client-connection-ip'];
  if (typeof netlify === 'string' && netlify.length > 0) return netlify;

  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  if (first) return first;

  return req.ip ?? 'unknown';
}

/**
 * Login and register: 10 attempts per IP per 15 minutes.
 *
 * Keyed on IP alone, not on IP + email. Keying on the email would let an
 * attacker spread attempts across many accounts from one address without ever
 * tripping the limit, which is exactly how credential stuffing works.
 */
export function createAuthLimiter(options: { force?: boolean } = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    standardHeaders: 'draft-7',
    keyGenerator: clientKey,
    legacyHeaders: false,
    // Failures are what we are limiting; a successful login should not consume
    // an attempt from someone who simply logs in often.
    skipSuccessfulRequests: true,
    skip: () => isTest && !options.force,
    handler: limitResponse,
  });
}

/**
 * Public unauthenticated forms — volunteer applications, anonymous feedback
 * (FR-33.8, FR-32.6). Tighter still, because they write rows and dispatch mail.
 */
export function createPublicFormLimiter(
  options: { force?: boolean } = {},
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    limit: Number(process.env.PUBLIC_FORM_RATE_LIMIT_MAX ?? 5),
    standardHeaders: 'draft-7',
    keyGenerator: clientKey,
    legacyHeaders: false,
    skip: () => isTest && !options.force,
    handler: limitResponse,
  });
}

/** Everything else. */
export function createGeneralLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_MAX ?? 100),
    standardHeaders: 'draft-7',
    keyGenerator: clientKey,
    legacyHeaders: false,
    skip: () => isTest,
    handler: limitResponse,
  });
}
