/**
 * Tutor aggregate — profile, claims, rates, documents, availability, safety.
 *
 * Everything crossing this boundary is a domain object: booleans are booleans,
 * JSON columns are arrays and objects, timestamps are `Date`.  The integer 0/1
 * and the serialised text stay on the database side of the line.
 */

import { eq } from 'drizzle-orm';

import {
  fromDbBool,
  fromDbJsonArray,
  fromDbTimestamp,
  newId,
  nowIso,
  toDbBool,
  toDbJson,
} from '../../shared/db-values';
import { assertPrivateStoragePath } from '../../shared/storage-path';
import type { TeachingMode } from '../../shared/rates';
import { tutorDocuments, tutorProfiles, tutorSafetyConstraints } from '../db/schema/tutor';
import type { ProfileStatus, TutorGender } from '../db/schema/tutor';
import { type Executor, NotFoundError } from './_base';

/* -------------------------------------------------------------------------
 * Domain shapes
 * ---------------------------------------------------------------------- */

export interface TutorProfileRecord {
  id: string;
  userId: string;
  gender: TutorGender;
  cityId: string;
  bio: string | null;
  bioUr: string | null;
  qualifications: string | null;
  experienceYears: number;
  teachesAtHome: boolean;
  teachesOnline: boolean;
  teachesAtOwnPlace: boolean;
  willingAreaIds: string[];
  volunteer: boolean;
  profileStatus: ProfileStatus;
  slug: string;
  createdAt: Date;
}

export interface CreateTutorProfileInput {
  userId: string;
  gender: TutorGender;
  cityId: string;
  slug: string;
  bio?: string | null;
  bioUr?: string | null;
  qualifications?: string | null;
  experienceYears?: number;
  teachesAtHome?: boolean;
  teachesOnline?: boolean;
  teachesAtOwnPlace?: boolean;
  willingAreaIds?: string[];
  volunteer?: boolean;
  profileStatus?: ProfileStatus;
}

type StoredTutorProfile = typeof tutorProfiles.$inferSelect;

export function toTutorDomain(row: StoredTutorProfile): TutorProfileRecord {
  return {
    id: row.id,
    userId: row.userId,
    gender: row.gender,
    cityId: row.cityId,
    bio: row.bio,
    bioUr: row.bioUr,
    qualifications: row.qualifications,
    experienceYears: row.experienceYears,
    teachesAtHome: fromDbBool(row.teachesAtHome),
    teachesOnline: fromDbBool(row.teachesOnline),
    teachesAtOwnPlace: fromDbBool(row.teachesAtOwnPlace),
    willingAreaIds: fromDbJsonArray(row.willingAreasJson),
    volunteer: fromDbBool(row.volunteerFlag),
    profileStatus: row.profileStatus,
    slug: row.slug,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

/* -------------------------------------------------------------------------
 * Profile
 * ---------------------------------------------------------------------- */

export async function createTutorProfile(
  db: Executor,
  input: CreateTutorProfileInput,
): Promise<TutorProfileRecord> {
  const id = newId();

  await db.insert(tutorProfiles).values({
    id,
    userId: input.userId,
    gender: input.gender,
    cityId: input.cityId,
    slug: input.slug,
    bio: input.bio ?? null,
    bioUr: input.bioUr ?? null,
    qualifications: input.qualifications ?? null,
    experienceYears: input.experienceYears ?? 0,
    teachesAtHome: toDbBool(input.teachesAtHome ?? false),
    teachesOnline: toDbBool(input.teachesOnline ?? false),
    teachesAtOwnPlace: toDbBool(input.teachesAtOwnPlace ?? false),
    willingAreasJson: toDbJson(input.willingAreaIds ?? []) ?? '[]',
    volunteerFlag: toDbBool(input.volunteer ?? false),
    profileStatus: input.profileStatus ?? 'draft',
    createdAt: nowIso(),
  });

  return getTutorProfileOrThrow(db, id);
}

export async function findTutorProfile(
  db: Executor,
  id: string,
): Promise<TutorProfileRecord | null> {
  const rows = await db.select().from(tutorProfiles).where(eq(tutorProfiles.id, id)).limit(1);
  return rows[0] ? toTutorDomain(rows[0]) : null;
}

export async function getTutorProfileOrThrow(
  db: Executor,
  id: string,
): Promise<TutorProfileRecord> {
  const found = await findTutorProfile(db, id);
  if (!found) throw new NotFoundError('tutor profile', id);
  return found;
}

export async function findTutorProfileBySlug(
  db: Executor,
  slug: string,
): Promise<TutorProfileRecord | null> {
  const rows = await db.select().from(tutorProfiles).where(eq(tutorProfiles.slug, slug)).limit(1);
  return rows[0] ? toTutorDomain(rows[0]) : null;
}

/**
 * Search lives in `server/repositories/search.ts`, not here.
 *
 * This module is the tutor's own view of their own profile — an owner may read
 * their draft. Anything that puts a tutor in front of a *family* must go
 * through the searchable predicate, and keeping the two in separate modules is
 * what makes "did this query filter on approval?" answerable by looking at one
 * import line (FR-6.3).
 */

/**
 * Patch profile fields.
 *
 * `profileStatus` is accepted here because the repository is persistence, but
 * the only callers are `server/services/tutor-onboarding.ts` (which can reach
 * `draft`, `pending_verification` and `under_review`) and the administrator
 * verification service (which is the only thing that may write `approved`).
 * No route hands a status through from a request body — see
 * `shared/tutor-onboarding.ts`, where the field simply does not exist.
 */
export async function updateTutorProfileFields(
  db: Executor,
  id: string,
  input: Partial<{
    gender: TutorGender;
    cityId: string;
    bio: string | null;
    bioUr: string | null;
    qualifications: string | null;
    experienceYears: number;
    teachesAtHome: boolean;
    teachesOnline: boolean;
    teachesAtOwnPlace: boolean;
    willingAreaIds: string[];
    volunteer: boolean;
    profileStatus: ProfileStatus;
  }>,
): Promise<TutorProfileRecord> {
  const values: Record<string, unknown> = {};

  if (input.gender !== undefined) values.gender = input.gender;
  if (input.cityId !== undefined) values.cityId = input.cityId;
  if (input.bio !== undefined) values.bio = input.bio;
  if (input.bioUr !== undefined) values.bioUr = input.bioUr;
  if (input.qualifications !== undefined) values.qualifications = input.qualifications;
  if (input.experienceYears !== undefined) values.experienceYears = input.experienceYears;
  if (input.teachesAtHome !== undefined) values.teachesAtHome = toDbBool(input.teachesAtHome);
  if (input.teachesOnline !== undefined) values.teachesOnline = toDbBool(input.teachesOnline);
  if (input.teachesAtOwnPlace !== undefined) {
    values.teachesAtOwnPlace = toDbBool(input.teachesAtOwnPlace);
  }
  if (input.willingAreaIds !== undefined) {
    values.willingAreasJson = toDbJson(input.willingAreaIds) ?? '[]';
  }
  if (input.volunteer !== undefined) values.volunteerFlag = toDbBool(input.volunteer);
  if (input.profileStatus !== undefined) values.profileStatus = input.profileStatus;

  if (Object.keys(values).length > 0) {
    await db.update(tutorProfiles).set(values).where(eq(tutorProfiles.id, id));
  }
  return getTutorProfileOrThrow(db, id);
}

/** The tutor's own profile, whatever its status. Owner-scoped reads only. */
export async function findTutorProfileByUserId(
  db: Executor,
  userId: string,
): Promise<TutorProfileRecord | null> {
  const rows = await db
    .select()
    .from(tutorProfiles)
    .where(eq(tutorProfiles.userId, userId))
    .limit(1);
  return rows[0] ? toTutorDomain(rows[0]) : null;
}

export async function updateTutorModes(
  db: Executor,
  id: string,
  modes: { teachesAtHome?: boolean; teachesOnline?: boolean; teachesAtOwnPlace?: boolean },
): Promise<TutorProfileRecord> {
  const patch: Record<string, number> = {};
  if (modes.teachesAtHome !== undefined) patch.teachesAtHome = toDbBool(modes.teachesAtHome);
  if (modes.teachesOnline !== undefined) patch.teachesOnline = toDbBool(modes.teachesOnline);
  if (modes.teachesAtOwnPlace !== undefined) {
    patch.teachesAtOwnPlace = toDbBool(modes.teachesAtOwnPlace);
  }

  await db.update(tutorProfiles).set(patch).where(eq(tutorProfiles.id, id));
  return getTutorProfileOrThrow(db, id);
}

/**
 * The volunteer weekly-hours cap — FR-33.11.
 *
 * Its own function rather than a field on `updateTutorProfileFields`, because
 * this is a **capacity limit enforced at booking**, not a profile detail a
 * tutor edits. `assertVolunteerCapacity` in `server/services/booking-create.ts`
 * reads it to refuse an over-commitment, so a tutor who could raise it through
 * the ordinary profile-edit path could raise their own ceiling.
 */
export async function setVolunteerCap(
  db: Executor,
  id: string,
  weeklyHours: number | null,
): Promise<TutorProfileRecord> {
  await db
    .update(tutorProfiles)
    .set({ volunteerWeeklyHours: weeklyHours })
    .where(eq(tutorProfiles.id, id));
  return getTutorProfileOrThrow(db, id);
}

export async function deleteTutorProfile(db: Executor, id: string): Promise<void> {
  await db.delete(tutorProfiles).where(eq(tutorProfiles.id, id));
}

/* -------------------------------------------------------------------------
 * Safety constraints — SEC-19 to SEC-21
 * ---------------------------------------------------------------------- */

export interface TutorSafetyRecord {
  tutorId: string;
  femaleStudentsOnly: boolean;
  guardianPresenceRequired: boolean;
  restrictedAreaIds: string[];
  updatedAt: Date;
}

/**
 * A tutor's own conditions.  **Enforced by the system, not displayed as
 * preferences** — a tutor restricted to female students is absent from a search
 * for a male student, the same hard-exclusion discipline the family's gender
 * filter gets.
 */
export async function upsertSafetyConstraints(
  db: Executor,
  input: {
    tutorId: string;
    femaleStudentsOnly: boolean;
    guardianPresenceRequired: boolean;
    restrictedAreaIds: string[];
  },
): Promise<TutorSafetyRecord> {
  const existing = await db
    .select()
    .from(tutorSafetyConstraints)
    .where(eq(tutorSafetyConstraints.tutorId, input.tutorId))
    .limit(1);

  const values = {
    femaleStudentsOnly: toDbBool(input.femaleStudentsOnly),
    guardianPresenceRequired: toDbBool(input.guardianPresenceRequired),
    restrictedAreaIdsJson: toDbJson(input.restrictedAreaIds) ?? '[]',
    updatedAt: nowIso(),
  };

  if (existing[0]) {
    await db
      .update(tutorSafetyConstraints)
      .set(values)
      .where(eq(tutorSafetyConstraints.tutorId, input.tutorId));
  } else {
    await db
      .insert(tutorSafetyConstraints)
      .values({ id: newId(), tutorId: input.tutorId, ...values });
  }

  return getSafetyConstraintsOrThrow(db, input.tutorId);
}

export async function findSafetyConstraints(
  db: Executor,
  tutorId: string,
): Promise<TutorSafetyRecord | null> {
  const rows = await db
    .select()
    .from(tutorSafetyConstraints)
    .where(eq(tutorSafetyConstraints.tutorId, tutorId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  return {
    tutorId: row.tutorId,
    femaleStudentsOnly: fromDbBool(row.femaleStudentsOnly),
    guardianPresenceRequired: fromDbBool(row.guardianPresenceRequired),
    restrictedAreaIds: fromDbJsonArray(row.restrictedAreaIdsJson),
    updatedAt: fromDbTimestamp(row.updatedAt),
  };
}

async function getSafetyConstraintsOrThrow(
  db: Executor,
  tutorId: string,
): Promise<TutorSafetyRecord> {
  const found = await findSafetyConstraints(db, tutorId);
  if (!found) throw new NotFoundError('tutor safety constraints', tutorId);
  return found;
}

/* -------------------------------------------------------------------------
 * Documents — SEC-7, NFR-9
 * ---------------------------------------------------------------------- */

export interface TutorDocumentRecord {
  id: string;
  tutorId: string;
  docType: (typeof tutorDocuments.$inferSelect)['docType'];
  storagePath: string;
  uploadedAt: Date;
}

/**
 * `storagePath` is validated on the way in: it must be a key inside the private
 * bucket, never a public URL and never a path inside this repository.  A
 * mistake here is not a bug in a listing, it is a CNIC image on the open web.
 */
export async function addTutorDocument(
  db: Executor,
  input: { tutorId: string; docType: TutorDocumentRecord['docType']; storagePath: string },
): Promise<TutorDocumentRecord> {
  assertPrivateStoragePath(input.storagePath);

  const id = newId();
  await db.insert(tutorDocuments).values({
    id,
    tutorId: input.tutorId,
    docType: input.docType,
    storagePath: input.storagePath,
    uploadedAt: nowIso(),
  });

  const rows = await db.select().from(tutorDocuments).where(eq(tutorDocuments.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('tutor document', id);

  return {
    id: row.id,
    tutorId: row.tutorId,
    docType: row.docType,
    storagePath: row.storagePath,
    uploadedAt: fromDbTimestamp(row.uploadedAt),
  };
}

export async function listTutorDocuments(
  db: Executor,
  tutorId: string,
): Promise<TutorDocumentRecord[]> {
  const rows = await db
    .select()
    .from(tutorDocuments)
    .where(eq(tutorDocuments.tutorId, tutorId));

  return rows.map((row) => ({
    id: row.id,
    tutorId: row.tutorId,
    docType: row.docType,
    storagePath: row.storagePath,
    uploadedAt: fromDbTimestamp(row.uploadedAt),
  }));
}

export async function deleteTutorDocument(db: Executor, id: string): Promise<void> {
  await db.delete(tutorDocuments).where(eq(tutorDocuments.id, id));
}

export type { TeachingMode };
