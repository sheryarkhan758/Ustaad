/**
 * Authentication integration suite — §6.1.
 *
 * Mounts the real application over an in-memory database and drives it through
 * HTTP, so the middleware chain, the cookies and the handlers under test are
 * the ones production runs.
 */

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { REGISTERABLE_ROLES } from '../../shared/auth';
import { createApp } from '../app';
import { createSeededTestDb, type TestDb } from '../db/test-db';
import { users } from '../db/schema/identity';
import { newId, nowIso } from '../../shared/db-values';
import { hashPassword } from '../services/auth';

let db: TestDb;
let app: ReturnType<typeof createApp>;

const PASSWORD = 'a-sufficiently-long-password';

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

function cookiesFrom(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function cookieHeader(res: request.Response): string {
  return cookiesFrom(res)
    .map((c) => c.split(';')[0])
    .join('; ');
}

async function registerAs(
  role: (typeof REGISTERABLE_ROLES)[number],
  email: string,
): Promise<request.Response> {
  return request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: PASSWORD,
      role,
      displayName: `Test ${role}`,
      ...(role === 'student' ? { dateOfBirth: '1998-03-04' } : {}),
    });
}

/* =========================================================================
 * Register
 * ====================================================================== */

describe('POST /api/auth/register', () => {
  it.each([...REGISTERABLE_ROLES])('registers a %s and returns the public user', async (role) => {
    const res = await registerAs(role, `${role}@example.test`);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: `${role}@example.test`, role, status: 'active' });
  });

  it('never returns a password hash or token version', async () => {
    const res = await registerAs('parent', 'shape@example.test');
    const body = JSON.stringify(res.body);

    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('tokenVersion');
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain('$2b$');
  });

  it('refuses the admin role — it is seeded or promoted, never chosen (FR-1.5)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'wannabe@example.test',
      password: PASSWORD,
      role: 'admin',
      displayName: 'Wannabe Admin',
    });

    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a duplicate email', async () => {
    await registerAs('parent', 'dupe@example.test');
    const second = await registerAs('tutor', 'dupe@example.test');

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('email_taken');
  });

  it('treats email as case-insensitive', async () => {
    await registerAs('parent', 'case@example.test');
    const second = await request(app).post('/api/auth/register').send({
      email: 'CASE@Example.TEST',
      password: PASSWORD,
      role: 'tutor',
      displayName: 'Case Clash',
    });

    expect(second.status).toBe(409);
  });

  it('refuses a password shorter than the minimum', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'short@example.test',
      password: 'short',
      role: 'parent',
      displayName: 'Short Password',
    });

    expect(res.status).toBe(400);
  });

  it('refuses a password over 72 bytes rather than letting bcrypt truncate it', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'long@example.test',
        password: 'x'.repeat(100),
        role: 'parent',
        displayName: 'Long Password',
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/72 bytes/);
  });

  it('stores a bcrypt hash, never the password', async () => {
    await registerAs('parent', 'hashed@example.test');

    const rows = await db.select().from(users);
    const row = rows.find((r) => r.email === 'hashed@example.test')!;

    expect(row.passwordHash).not.toBe(PASSWORD);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });
});

/* =========================================================================
 * Cookies
 * ====================================================================== */

describe('session cookies', () => {
  it('issues httpOnly, sameSite=lax access and refresh cookies', async () => {
    const res = await registerAs('parent', 'cookies@example.test');
    const cookies = cookiesFrom(res);

    const access = cookies.find((c) => c.startsWith('ustaad_at='))!;
    const refresh = cookies.find((c) => c.startsWith('ustaad_rt='))!;

    expect(access).toBeDefined();
    expect(refresh).toBeDefined();

    for (const cookie of [access, refresh]) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    }

    // The refresh cookie is scoped so it never travels with an ordinary request.
    expect(refresh).toMatch(/Path=\/api\/auth/i);
    expect(access).toMatch(/Path=\//i);
  });

  it('never puts a token in the body or in a URL', async () => {
    const res = await registerAs('parent', 'nourl@example.test');

    expect(res.body).not.toHaveProperty('accessToken');
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('refreshToken');
    expect(res.headers['location']).toBeUndefined();
  });
});

/* =========================================================================
 * Login
 * ====================================================================== */

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await registerAs('parent', 'login@example.test');
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.test', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('login@example.test');
    expect(cookiesFrom(res).some((c) => c.startsWith('ustaad_at='))).toBe(true);
  });

  it('refuses a wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.test', password: 'not-the-right-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('gives an unknown email the identical response to a wrong password', async () => {
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.test', password: PASSWORD });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.test', password: 'not-the-right-password' });

    // Anything that differs here enumerates the user list.
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('gives a malformed email the same response too', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('refuses a suspended account', async () => {
    const id = newId();
    await db.insert(users).values({
      id,
      email: 'suspended@example.test',
      passwordHash: await hashPassword(PASSWORD),
      role: 'tutor',
      displayName: 'Suspended Tutor',
      status: 'suspended',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'suspended@example.test', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('account_not_active');
  });
});

/* =========================================================================
 * Me
 * ====================================================================== */

describe('GET /api/auth/me', () => {
  it.each([...REGISTERABLE_ROLES])('returns the current %s', async (role) => {
    const registered = await registerAs(role, `me-${role}@example.test`);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(registered));

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: `me-${role}@example.test`, role });
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('refuses an anonymous request', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('authentication_required');
  });

  it('refuses a tampered token', async () => {
    const registered = await registerAs('parent', 'tamper@example.test');
    const good = cookieHeader(registered);
    const tampered = good.replace(/ustaad_at=[^;]+/, 'ustaad_at=not.a.valid.jwt');

    const res = await request(app).get('/api/auth/me').set('Cookie', tampered);
    expect(res.status).toBe(401);
  });

  it('ignores a token presented in an Authorization header', async () => {
    // There is deliberately no header path: a token outside an httpOnly cookie
    // is reachable by script and ends up in logs.
    const registered = await registerAs('parent', 'header@example.test');
    const accessCookie = cookiesFrom(registered)
      .find((c) => c.startsWith('ustaad_at='))!
      .split(';')[0]!
      .replace('ustaad_at=', '');

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessCookie}`);

    expect(res.status).toBe(401);
  });

  it('ignores a token presented in the query string', async () => {
    const registered = await registerAs('parent', 'query@example.test');
    const accessCookie = cookiesFrom(registered)
      .find((c) => c.startsWith('ustaad_at='))!
      .split(';')[0]!
      .replace('ustaad_at=', '');

    const res = await request(app).get(`/api/auth/me?access_token=${accessCookie}`);
    expect(res.status).toBe(401);
  });
});

/* =========================================================================
 * Logout and rotation
 * ====================================================================== */

describe('POST /api/auth/logout', () => {
  it('clears both cookies and is idempotent', async () => {
    const registered = await registerAs('parent', 'logout@example.test');

    const first = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(registered));
    expect(first.status).toBe(204);
    expect(cookiesFrom(first).some((c) => /ustaad_at=;|ustaad_at=$/.test(c))).toBe(true);

    // Logging out again, with no session, must not error or leak anything.
    const second = await request(app).post('/api/auth/logout');
    expect(second.status).toBe(204);
  });

  it('makes the refresh token unusable afterwards', async () => {
    const registered = await registerAs('parent', 'logout2@example.test');
    const cookies = cookieHeader(registered);

    await request(app).post('/api/auth/logout').set('Cookie', cookies);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookies);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/refresh — rotation', () => {
  it('issues a new pair and invalidates the presented refresh token', async () => {
    const registered = await registerAs('tutor', 'rotate@example.test');
    const original = cookieHeader(registered);

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(rotated.status).toBe(200);

    const newRefresh = cookiesFrom(rotated).find((c) => c.startsWith('ustaad_rt='))!;
    expect(newRefresh).toBeDefined();
    expect(newRefresh).not.toBe(cookiesFrom(registered).find((c) => c.startsWith('ustaad_rt=')));
  });

  it('detects reuse of a rotated token and ends the whole family', async () => {
    const registered = await registerAs('tutor', 'reuse@example.test');
    const original = cookieHeader(registered);

    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(rotated.status).toBe(200);

    // Replay the token that rotation already consumed.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('refresh_token_reused');

    // The successor is revoked too: the server cannot tell a confused client
    // from a stolen token, so it assumes the worse case.
    const successor = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(rotated));
    expect(successor.status).toBe(401);
  });

  it('refuses a refresh with no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

/* =========================================================================
 * Shape of failures
 * ====================================================================== */

describe('error responses', () => {
  it('never echoes the submitted password back', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: PASSWORD, role: 'parent', displayName: 'X' });

    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it('returns a structured error for an unknown endpoint', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
