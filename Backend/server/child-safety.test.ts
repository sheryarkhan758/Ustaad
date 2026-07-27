/**
 * The child-safety property, tested as a structural fact.
 *
 * Specification decision 2 calls this "a structural child-safety property
 * rather than a policy that could be violated". A policy is a check somebody
 * remembered to write; a structure is the absence of anywhere to put the thing.
 * These tests assert the absence.
 *
 * They fall into three groups:
 *
 *  1. **Schema** — `student_profiles` has no credential column, and nothing
 *     that issues a session can point at it. If a future migration adds one,
 *     these fail before any route does.
 *  2. **Registration** — every plausible attempt to obtain credentials for a
 *     minor, through the API, is refused.
 *  3. **Codebase** — no path exists that would create such credentials.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Table, getTableColumns, getTableName, is } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { REGISTERABLE_ROLES, registerSchema } from '../shared/auth';
import { assertExactlyOneOwner, assertMinorIsParentOwned } from '../shared/student-profile';
import { createApp } from './app';
import { createSeededTestDb, type TestDb } from './db/test-db';
import * as schema from './db/schema/index';
import { refreshTokens } from './db/schema/auth';
import { studentProfiles, users } from './db/schema/identity';
import { newId, nowIso } from '../shared/db-values';

let db: TestDb;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
});

/* =========================================================================
 * 1. Structure — there is nowhere to put a minor's credentials
 * ====================================================================== */

describe('the schema gives a minor nowhere to hold credentials', () => {
  it('student_profiles has no password, email, phone or token column', () => {
    const columns = Object.keys(getTableColumns(studentProfiles));

    for (const forbidden of [
      'passwordHash',
      'password',
      'email',
      'phone',
      'tokenVersion',
      'lastLoginAt',
    ]) {
      expect(columns, `student_profiles must never carry "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('student_profiles is owned by a parent account or is an adult acting alone', () => {
    const columns = Object.keys(getTableColumns(studentProfiles));
    expect(columns).toContain('parentUserId');
    expect(columns).toContain('selfUserId');
  });

  it('refresh_tokens can only belong to a users row, with no alternative owner', () => {
    const columns = Object.keys(getTableColumns(refreshTokens));
    expect(columns).toContain('userId');
    // No second owner column means a session literally cannot be recorded
    // against a learner who has no account.
    expect(columns).not.toContain('studentProfileId');
    expect(columns).not.toContain('minorId');
  });

  it('no table anywhere carries a credential column keyed to a student profile', () => {
    for (const value of Object.values(schema)) {
      if (!is(value, Table)) continue;
      const name = getTableName(value);
      const columns = Object.keys(getTableColumns(value));

      const hasCredential = columns.some((c) =>
        /^(passwordHash|password|tokenHash|tokenVersion)$/.test(c),
      );
      const pointsAtStudentProfile = columns.includes('studentProfileId');

      expect(
        hasCredential && pointsAtStudentProfile,
        `${name} holds both a credential and a student_profile reference`,
      ).toBe(false);
    }
  });
});

/* =========================================================================
 * 2. Registration refuses, by every route in
 * ====================================================================== */

const ADULT_DOB = '2000-01-01';
const MINOR_DOB = '2014-06-15'; // 12 years old as of the spec date.

describe('no request can obtain credentials for a minor', () => {
  it('refuses a student registration with a date of birth under 18', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'child@example.test',
      password: 'a-long-enough-password',
      role: 'student',
      displayName: 'A Child',
      dateOfBirth: MINOR_DOB,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(JSON.stringify(res.body)).toMatch(/may not hold an account/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a student registration that omits a date of birth entirely', async () => {
    // The obvious way round the previous test: just do not say how old you are.
    const res = await request(app).post('/api/auth/register').send({
      email: 'ageless@example.test',
      password: 'a-long-enough-password',
      role: 'student',
      displayName: 'No Age Given',
    });

    expect(res.status).toBe(400);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('refuses one day short of the eighteenth birthday', async () => {
    const today = new Date();
    const oneDayShort = new Date(
      Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate() + 1),
    );

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'almost@example.test',
        password: 'a-long-enough-password',
        role: 'student',
        displayName: 'Almost Eighteen',
        dateOfBirth: oneDayShort.toISOString().slice(0, 10),
      });

    expect(res.status).toBe(400);
  });

  it('accepts an adult student on exactly their eighteenth birthday', async () => {
    const today = new Date();
    const exactlyEighteen = new Date(
      Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()),
    );

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'eighteen@example.test',
        password: 'a-long-enough-password',
        role: 'student',
        displayName: 'Exactly Eighteen',
        dateOfBirth: exactlyEighteen.toISOString().slice(0, 10),
      });

    expect(res.status).toBe(201);
  });

  it('has no role a minor could register as', () => {
    // The complete set. There is no "child", "minor", "dependent" or "learner".
    expect([...REGISTERABLE_ROLES].sort()).toEqual([
      'organisation',
      'parent',
      'student',
      'tutor',
    ]);
  });

  it('cannot be tricked by a role the schema does not know', async () => {
    for (const role of ['minor', 'child', 'dependent', 'admin']) {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `${role}@example.test`,
          password: 'a-long-enough-password',
          role,
          displayName: 'Attempted',
          dateOfBirth: ADULT_DOB,
        });

      expect(res.status, `role "${role}" must be refused`).toBe(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('cannot be tricked by supplying a parent id alongside a registration', async () => {
    // A caller trying to create "an account for my child, owned by me".
    const res = await request(app).post('/api/auth/register').send({
      email: 'child2@example.test',
      password: 'a-long-enough-password',
      role: 'student',
      displayName: 'A Child',
      dateOfBirth: MINOR_DOB,
      parentUserId: 'some-parent-id',
      guardianUserId: 'some-parent-id',
    });

    expect(res.status).toBe(400);

    // And even had it succeeded, the extra fields are stripped by the schema —
    // `users` has no column for them.
    const parsed = registerSchema.safeParse({
      email: 'x@example.test',
      password: 'a-long-enough-password',
      role: 'parent',
      displayName: 'A Parent',
      parentUserId: 'injected',
      guardianUserId: 'injected',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'parentUserId' in parsed.data).toBe(false);
  });

  it('gives a minor no login path, because there is no row to authenticate', async () => {
    // Create a minor the correct way: a profile owned by a parent.
    const parentId = newId();
    await db.insert(users).values({
      id: parentId,
      email: 'realparent@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'parent',
      displayName: 'Real Parent',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const studentProfileId = newId();
    await db.insert(studentProfiles).values({
      id: studentProfileId,
      parentUserId: parentId,
      name: 'Ayesha',
      levelId: 'matric',
      boardId: 'sindh-board',
      dateOfBirth: MINOR_DOB,
      createdAt: nowIso(),
    });

    // The minor exists. There is no credential to present, and nothing to
    // present it to — login takes an email, and she has none.
    for (const attempt of [studentProfileId, 'Ayesha', '']) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: attempt, password: 'anything-at-all' });
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
});

/* =========================================================================
 * 3. The application-code guards
 * ====================================================================== */

describe('the student-profile ownership guard', () => {
  it('refuses a profile with both a parent owner and a self owner', () => {
    expect(() =>
      assertExactlyOneOwner({ parentUserId: 'parent-1', selfUserId: 'user-1' }),
    ).toThrow(/may not have both/i);
  });

  it('refuses a profile with no owner at all', () => {
    expect(() => assertExactlyOneOwner({})).toThrow(/exactly one owner/i);
  });

  it('refuses to let an under-18 profile own itself', () => {
    expect(() =>
      assertMinorIsParentOwned(
        { selfUserId: 'user-1', dateOfBirth: MINOR_DOB },
        new Date('2026-07-26T00:00:00Z'),
      ),
    ).toThrow(/may not hold an account/i);
  });

  it('allows an adult to own their own profile', () => {
    expect(() =>
      assertMinorIsParentOwned(
        { selfUserId: 'user-1', dateOfBirth: ADULT_DOB },
        new Date('2026-07-26T00:00:00Z'),
      ),
    ).not.toThrow();
  });
});

/* =========================================================================
 * 4. Codebase — no path exists that could create such credentials
 * ====================================================================== */

describe('no code path issues credentials to a minor', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'migrations' ? [] : walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const files = [...walk('server'), ...walk('shared')].filter(
    (f) => !f.endsWith('child-safety.test.ts'),
  );

  it('never writes a password hash on the same statement as a student profile', () => {
    for (const file of files) {
      const code = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      const insertsStudentProfile = /insert\(\s*studentProfiles\s*\)/.test(code);
      if (!insertsStudentProfile) continue;

      // The statement that creates a learner must not carry a credential.
      expect(code, `${file} inserts a student profile near a password hash`).not.toMatch(
        /insert\(\s*studentProfiles\s*\)[\s\S]{0,400}passwordHash/,
      );
    }
  });

  it('exposes no function whose name suggests creating an account for a minor', async () => {
    const authService = await import('./services/auth');
    const usersRepo = await import('./repositories/users');

    const names = [...Object.keys(authService), ...Object.keys(usersRepo)];
    for (const name of names) {
      expect(name, `"${name}" reads as a minor-credential path`).not.toMatch(
        /minor|child|guardian|dependent/i,
      );
    }
  });

  it('has exactly one function that creates a users row', () => {
    // If a second one appears, it needs the same scrutiny as the first.
    const source = fs.readFileSync('server/repositories/users.ts', 'utf8');
    const inserts = source.match(/\.insert\(users\)/g) ?? [];
    expect(inserts).toHaveLength(1);
  });
});
