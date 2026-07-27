/**
 * Rate limiting on the credential endpoints.
 *
 * The limiters are skipped under `NODE_ENV=test` so that an integration suite
 * making dozens of legitimate logins does not trip them. This file forces them
 * back on, so the behaviour is still covered rather than merely configured.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAuthLimiter, createPublicFormLimiter } from './rate-limit';

function appWith(limiter: express.RequestHandler): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/attempt', limiter, (_req, res) => {
    // Always a failure, because `skipSuccessfulRequests` means only failures
    // consume the allowance — which is the behaviour worth testing.
    res.status(401).json({ error: { code: 'invalid_credentials' } });
  });
  return app;
}

describe('the auth limiter', () => {
  let app: Express;

  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
    app = appWith(createAuthLimiter({ force: true }));
  });

  it('allows attempts up to the limit, then returns 429', async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await request(app).post('/attempt').send({});
      expect(res.status, `attempt ${attempt} should still be allowed`).toBe(401);
    }

    const blocked = await request(app).post('/attempt').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('too_many_requests');
  });

  it('does not name the limit or the window in the body', async () => {
    for (let i = 0; i < 4; i += 1) await request(app).post('/attempt').send({});
    const blocked = await request(app).post('/attempt').send({});

    // Standard headers carry the numbers for a well-behaved client; the body
    // does not hand an attacker a schedule to pace against.
    expect(JSON.stringify(blocked.body)).not.toMatch(/\b3\b|60000/);
  });

  it('keys on the caller, not on the submitted email', async () => {
    // Keying on email would let one address spread attempts across many
    // accounts without ever tripping the limit — which is exactly how
    // credential stuffing works.
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/attempt').send({ email: `victim-${i}@example.test` });
    }
    const blocked = await request(app).post('/attempt').send({ email: 'another@example.test' });
    expect(blocked.status).toBe(429);
  });
});

describe('the public-form limiter', () => {
  it('is tighter than the auth limiter, because each request writes a row', async () => {
    process.env.PUBLIC_FORM_RATE_LIMIT_MAX = '2';
    const app = appWith(createPublicFormLimiter({ force: true }));

    await request(app).post('/attempt').send({});
    await request(app).post('/attempt').send({});

    const blocked = await request(app).post('/attempt').send({});
    expect(blocked.status).toBe(429);
  });
});
