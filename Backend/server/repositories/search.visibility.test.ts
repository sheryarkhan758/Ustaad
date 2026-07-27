/**
 * A submitted-but-unapproved tutor is invisible to search — FR-6.3, FR-6.10.
 *
 * This is the requirement the whole verification module exists to serve. If an
 * unapproved profile can reach a family, the platform's central claim — that
 * every tutor it shows has been checked against a CNIC and academic documents
 * by an administrator — is false, and the family has no way to know.
 *
 * Two kinds of test here, because one alone is not enough:
 *
 *  · **Behavioural** — every search entry point is called against every
 *    non-approved status and asserted to return nothing.
 *  · **Structural** — a sweep of the codebase asserting that no module other
 *    than `search.ts` selects from `tutor_profiles` for a public surface. A
 *    behavioural test only covers the queries that exist today.
 */

import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../../shared/db-values';
import { tutorProfiles } from '../db/schema/tutor';
import type { ProfileStatus } from '../db/schema/tutor';
import { PROFILE_STATUSES, SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import { users } from '../db/schema/identity';
import { createSeededTestDb, type TestDb } from '../db/test-db';
import { searchQuerySchema } from '../../shared/search';
import {
  findSearchableTutorBySlug,
  findSearchableTutorsByIds,
  isTutorSearchable,
  searchTutors as runSearch,
} from './search';

/** Parses through the real schema, so defaults match a real request. */
async function searchTutors(
  database: TestDb,
  filters: Record<string, unknown> = {},
): Promise<{ id: string; gender: string }[]> {
  const response = await runSearch(database, searchQuerySchema.parse(filters));
  return response.results.map((r) => ({ id: r.tutor.id, gender: r.tutor.gender }));
}

let db: TestDb;

const NON_APPROVED = PROFILE_STATUSES.filter((s) => s !== SEARCHABLE_PROFILE_STATUS);

async function makeTutor(status: ProfileStatus, slug: string): Promise<string> {
  const userId = newId();
  await db.insert(users).values({
    id: userId,
    email: `${slug}@example.test`,
    passwordHash: 'not-a-real-hash',
    role: 'tutor',
    displayName: slug,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  const tutorId = newId();
  await db.insert(tutorProfiles).values({
    id: tutorId,
    userId,
    gender: 'female',
    cityId: 'karachi',
    slug,
    profileStatus: status,
    teachesAtHome: 1,
    teachesOnline: 1,
    createdAt: nowIso(),
  });
  return tutorId;
}

beforeEach(async () => {
  db = await createSeededTestDb();
});

/* =========================================================================
 * Behaviour
 * ====================================================================== */

describe('every search entry point excludes a non-approved tutor', () => {
  it.each(NON_APPROVED)('excludes a tutor in "%s" from searchTutors', async (status) => {
    const tutorId = await makeTutor(status, `hidden-${status}`);

    // Unfiltered, and with each filter that might otherwise widen the net.
    for (const filters of [
      {},
      { cityId: 'karachi' },
      { genderPreference: 'female_only' as const },
      { genderPreference: 'no_preference' as const },
      { mode: 'home' as const },
      { mode: 'online' as const },
    ]) {
      const results = await searchTutors(db, filters);
      expect(results.map((r) => r.id), JSON.stringify(filters)).not.toContain(tutorId);
    }
  });

  it.each(NON_APPROVED)('excludes a tutor in "%s" from a slug lookup', async (status) => {
    // A slug is shareable and therefore guessable. The public profile page is
    // gated on the same predicate as the result list.
    await makeTutor(status, `slug-${status}`);
    expect(await findSearchableTutorBySlug(db, `slug-${status}`)).toBeNull();
  });

  it.each(NON_APPROVED)('excludes a tutor in "%s" from a lookup by id', async (status) => {
    // The comparison tray (§6.18) and the AI shortlist post-filter (FR-10.12)
    // both fetch by id. Neither may resurrect a hidden profile.
    const tutorId = await makeTutor(status, `byid-${status}`);
    expect(await findSearchableTutorsByIds(db, [tutorId])).toEqual([]);
    expect(await isTutorSearchable(db, tutorId)).toBe(false);
  });

  it('includes an approved tutor, so the tests above are not vacuous', async () => {
    const tutorId = await makeTutor('approved', 'visible-tutor');

    expect((await searchTutors(db, {})).map((r) => r.id)).toContain(tutorId);
    expect(await findSearchableTutorBySlug(db, 'visible-tutor')).not.toBeNull();
    expect(await findSearchableTutorsByIds(db, [tutorId])).toHaveLength(1);
    expect(await isTutorSearchable(db, tutorId)).toBe(true);
  });

  it('returns only the approved tutor when both exist side by side', async () => {
    const hidden = await makeTutor('pending_verification', 'submitted-tutor');
    const shown = await makeTutor('approved', 'approved-tutor');

    const ids = (await searchTutors(db, { cityId: 'karachi' })).map((r) => r.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
  });
});

/* =========================================================================
 * The hard filter, checked here because it shares the query
 * ====================================================================== */

describe('gender preference is a hard exclusion in the same query', () => {
  beforeEach(async () => {
    await makeTutor('approved', 'a-female-tutor');

    const maleUserId = newId();
    await db.insert(users).values({
      id: maleUserId,
      email: 'male@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'tutor',
      displayName: 'A Male Tutor',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await db.insert(tutorProfiles).values({
      id: newId(),
      userId: maleUserId,
      gender: 'male',
      cityId: 'karachi',
      slug: 'a-male-tutor',
      profileStatus: 'approved',
      teachesAtHome: 1,
      createdAt: nowIso(),
    });
  });

  it('returns no male tutor at all under female_only', async () => {
    // Absent from the result set, not ranked lower (FR-16.3).
    const results = await searchTutors(db, { genderPreference: 'female_only' });
    expect(results).toHaveLength(1);
    expect(results.every((r) => r.gender === 'female')).toBe(true);
  });

  it('returns both under no_preference, the default', async () => {
    // The system never pre-sets the filter on a user's behalf (FR-16.6).
    expect(await searchTutors(db, { genderPreference: 'no_preference' })).toHaveLength(2);
    expect(await searchTutors(db, {})).toHaveLength(2);
  });
});

/* =========================================================================
 * Structure — no other module may query tutor_profiles for a public surface
 * ====================================================================== */

describe('the searchable predicate has one home', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'migrations' ? [] : walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * Modules permitted to query `tutor_profiles` without the status filter.
   *
   * `search.ts` applies it. `tutors.ts` and `tutor-onboarding.ts` serve the
   * tutor's own owner-scoped view of their own draft, which is exactly the case
   * the filter must not apply to. Anything else is a new public surface and
   * needs a deliberate decision, which is what failing this test forces.
   */
  const ALLOWED = [
    'server/repositories/search.ts',
    'server/repositories/tutors.ts',
    'server/repositories/tutor-onboarding.ts',
    'server/db/test-db.ts',
    // The administrator verification queue exists precisely to list profiles
    // that are NOT approved (FR-6.4). It is administrator-only and is never a
    // public surface.
    'server/routes/admin-verification.ts',
    // The expiry job reads `userId` to know whom to notify. Back-office, and
    // it deliberately never touches profileStatus — asserted in
    // server/verification.flow.test.ts.
    'server/services/verification-expiry.ts',
    // The materialisation jobs read every profile by definition — they exist to
    // compute the columns search then reads. They write no response and are
    // never reachable from a request (NFR-15).
    'server/jobs/tutor-scores.ts',
    'server/jobs/tutor-reliability.ts',
    'server/jobs/rate-benchmarks.ts',
    // Booking creation reads two columns of the tutor being booked, for the
    // volunteer hour cap. It has already gated on `isTutorSearchable`, so it
    // cannot surface an unapproved profile — asserted in booking.flow.test.ts.
    'server/services/booking-create.ts',
    // Reads the tutor's user id to decide who may see a payment record, and the
    // volunteer flag to know whether there is a fee at all. Never a listing.
    'server/services/payment-records.ts',
    // The demonstration seed writes tutor profiles in every verification state
    // and reads them back to attach bookings and reviews (§6.15, FR-15.8). It
    // is a script, never reachable from a request.
    'server/db/seed/demo/index.ts',
    // The administrator dashboard counts profiles awaiting a decision (FR-14.3).
    // `countTutorProfilesIn` selects one column and returns an integer; there is
    // no overload that hands back the rows it counted, and the test below
    // asserts that. Administrator-only, and by definition about profiles that
    // are NOT approved — the same case as admin-verification.ts above.
    'server/repositories/admin.ts',
  ].map((f) => path.normalize(f));

  it('is the only module selecting from tutor_profiles', () => {
    const files = [...walk('server'), ...walk('shared')].filter(
      (f) => !f.endsWith('.test.ts') && !ALLOWED.includes(path.normalize(f)),
    );

    for (const file of files) {
      const code = strip(fs.readFileSync(file, 'utf8'));
      expect(code, `${file} queries tutor_profiles directly — route it through search.ts`).not.toMatch(
        /\.from\(\s*tutorProfiles\s*\)/,
      );
    }
  });

  /**
   * The dashboard's exemption is a scalar, and stays one.
   *
   * `server/repositories/admin.ts` is allowlisted above because FR-14.3 needs a
   * count of profiles awaiting a decision. The exemption is only defensible
   * while the module cannot hand back a profile row, so that is asserted rather
   * than trusted: every `.from(tutorProfiles)` in the file must be reached
   * through a narrow `select({ ... })` projection, and every function that
   * touches the table must declare `Promise<number>`.
   */
  it('lets the administrator dashboard count tutor_profiles but never list them', () => {
    const file = path.normalize('server/repositories/admin.ts');
    const code = strip(fs.readFileSync(file, 'utf8'));

    // A bare `.select()` before `.from(tutorProfiles)` would pull whole rows.
    expect(code, 'admin.ts must project columns explicitly, never select() whole rows').not.toMatch(
      /\.select\(\s*\)[\s\S]{0,200}?\.from\(\s*tutorProfiles\s*\)/,
    );

    // Every function in the file that mentions tutorProfiles returns a number.
    const functions = code.split(/export async function /).slice(1);
    for (const body of functions) {
      if (!/tutorProfiles/.test(body)) continue;
      const signature = body.slice(0, body.indexOf('{'));
      expect(
        signature,
        `${signature.split('(')[0]} touches tutor_profiles and must return a count, not rows`,
      ).toMatch(/Promise<number>/);
    }
  });

  it('never hard-codes the searchable profile status outside the constant', () => {
    // Narrowly about `profileStatus`. The bare word "approved" also names a
    // *verification decision* (`verification_records.decision`), which is a
    // different concept that happens to share a word — flagging those would be
    // noise, and noise is how a guard stops being read.
    const profileStatusLiteral =
      /profileStatus(\s*[:=]=?\s*|,\s*)'approved'|'approved'\s*===?\s*\w*[Pp]rofileStatus/;

    const files = [...walk('server'), ...walk('shared')].filter(
      (f) => !f.endsWith('.test.ts') && !path.normalize(f).includes(path.normalize('db/schema')),
    );

    const hits: string[] = [];
    for (const file of files) {
      const code = strip(fs.readFileSync(file, 'utf8'));
      if (profileStatusLiteral.test(code)) hits.push(file);
    }

    // Every comparison and assignment goes through SEARCHABLE_PROFILE_STATUS,
    // so a rename cannot leave a stale string filtering nothing.
    expect(hits, `these files hard-code the searchable status: ${hits.join(', ')}`).toEqual([]);
  });

  it('declares the searchable status exactly once', () => {
    const declaration = fs.readFileSync('server/db/schema/tutor.ts', 'utf8');
    expect(declaration).toContain("SEARCHABLE_PROFILE_STATUS = 'approved'");

    const others = [...walk('server'), ...walk('shared')].filter(
      (f) =>
        !f.endsWith('.test.ts') &&
        !path.normalize(f).endsWith(path.normalize('db/schema/tutor.ts')) &&
        !path.normalize(f).endsWith(path.normalize('db/schema-pg/tutor.ts')),
    );

    for (const file of others) {
      expect(strip(fs.readFileSync(file, 'utf8')), file).not.toMatch(
        /SEARCHABLE_PROFILE_STATUS\s*=\s*'/,
      );
    }
  });
});
