/**
 * In-memory database for tests.
 *
 * Applies the real migrations to a `:memory:` SQLite database and seeds the
 * real reference data, so a test exercises the same schema and the same
 * constraints as development — including foreign keys, which SQLite leaves off
 * by default and which every FK in this schema depends on.
 *
 * Fixtures go through the repository layer wherever one exists, so they
 * exercise the same boundary translation production code does. Test data is
 * synthetic and never leaves the process.
 */

import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { newId, nowIso } from '../../shared/db-values';
import * as schema from './schema/index';
import { guardAdminActionsWrites } from './runtime-guards';
import { SEARCHABLE_PROFILE_STATUS } from './schema/tutor';
import { seedReference } from './seed/reference';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export function createTestDb(): TestDb {
  const connection = new BetterSqlite3(':memory:');
  connection.pragma('foreign_keys = ON');
  const rawDb = drizzle(connection, { schema });
  migrate(rawDb, { migrationsFolder: 'server/db/migrations' });
  return guardAdminActionsWrites(rawDb);
}

/** Reference data, for tests that touch curriculum or location foreign keys. */
export async function createSeededTestDb(): Promise<TestDb> {
  const db = createTestDb();
  await seedReference(db as unknown as Parameters<typeof seedReference>[0]);
  return db;
}

export interface BookingFixture {
  parentUserId: string;
  tutorUserId: string;
  adminUserId: string;
  tutorProfileId: string;
  studentProfileId: string;
  bookingId: string;
}

/**
 * A minimal but realistic engagement: a parent account, a minor student profile
 * the parent owns, an approved female tutor, and a confirmed monthly booking.
 *
 * The student is deliberately a minor with `parentUserId` set and no account of
 * their own — that is the normal case on this platform (SEC-1).
 */
export async function createBookingFixture(db: TestDb): Promise<BookingFixture> {
  const parentUserId = newId();
  const tutorUserId = newId();
  const adminUserId = newId();
  const tutorProfileId = newId();
  const studentProfileId = newId();
  const bookingId = newId();

  await db.insert(schema.users).values([
    {
      id: parentUserId,
      email: 'parent@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'parent',
      displayName: 'Test Parent',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: tutorUserId,
      email: 'tutor@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'tutor',
      displayName: 'Test Tutor',
      gender: 'female',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: adminUserId,
      email: 'admin@example.test',
      passwordHash: 'not-a-real-hash',
      role: 'admin',
      displayName: 'Test Admin',
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ]);

  await db.insert(schema.tutorProfiles).values({
    id: tutorProfileId,
    userId: tutorUserId,
    gender: 'female',
    cityId: 'karachi',
    slug: 'test-tutor',
    profileStatus: SEARCHABLE_PROFILE_STATUS,
    teachesAtHome: 1,
    willingAreasJson: '["karachi-gulshan-e-iqbal"]',
    createdAt: nowIso(),
  });

  await db.insert(schema.studentProfiles).values({
    id: studentProfileId,
    parentUserId,
    name: 'Test Student',
    levelId: 'matric',
    boardId: 'sindh-board',
    dateOfBirth: '2011-04-02',
    createdAt: nowIso(),
  });

  await db.insert(schema.bookings).values({
    id: bookingId,
    tutorId: tutorProfileId,
    studentProfileId,
    requestedByUserId: parentUserId,
    engagementType: 'monthly',
    subjectId: 'mathematics',
    levelId: 'matric',
    boardId: 'sindh-board',
    topicIdsJson: '["math-matric-sindh-quadratic-equations"]',
    mode: 'home',
    areaId: 'karachi-gulshan-e-iqbal',
    status: 'confirmed',
    agreedRate: 800_000,
    rateType: 'monthly',
    guardianPresenceRequired: 1,
    requestedAt: nowIso(),
    createdAt: nowIso(),
  });

  return {
    parentUserId,
    tutorUserId,
    adminUserId,
    tutorProfileId,
    studentProfileId,
    bookingId,
  };
}
