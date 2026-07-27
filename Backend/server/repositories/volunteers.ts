/**
 * Volunteer application aggregate — §6.33.
 *
 * A volunteer is verified on exactly the same basis as a paid tutor, against
 * CNIC and academic documents under §6.6. **The fee is what differs, not the
 * standard** (FR-33.10) — the volunteer flag is never a shortcut through
 * verification.
 *
 * `createVolunteerApplication` writes the row and returns it with
 * `mailDispatchStatus: 'pending'`. The caller dispatches the EmailJS
 * notification afterwards and calls `recordMailDispatch` with the outcome
 * (FR-33.9, decision 22) — never the other way round, because a mail failure
 * must not lose an application the applicant believes was received.
 */

import { desc, eq } from 'drizzle-orm';

import { fromDbJsonArray, fromDbTimestamp, newId, nowIso, toDbJson } from '../../shared/db-values';
import { assertPrivateStoragePath } from '../../shared/storage-path';
import type { TeachingMode } from '../../shared/rates';
import type { Gender } from '../db/schema/identity';
import { volunteerApplications } from '../db/schema/platform';
import type { MailDispatchStatus, VolunteerStatus } from '../db/schema/platform';
import { type Executor, NotFoundError } from './_base';

export interface VolunteerApplicationRecord {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  cityId: string | null;
  areaId: string | null;
  gender: Gender | null;
  subjectIds: string[];
  levelIds: string[];
  weeklyHours: number | null;
  deliveryModes: TeachingMode[];
  /** Any script, stored unchanged, never translated (§2.10). */
  motivation: string | null;
  documentPath: string | null;
  status: VolunteerStatus;
  mailDispatchStatus: MailDispatchStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  convertedTutorId: string | null;
  createdAt: Date;
}

type Stored = typeof volunteerApplications.$inferSelect;

function toDomain(row: Stored): VolunteerApplicationRecord {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    cityId: row.cityId,
    areaId: row.areaId,
    gender: row.gender,
    subjectIds: fromDbJsonArray(row.subjectsJson),
    levelIds: fromDbJsonArray(row.levelsJson),
    weeklyHours: row.weeklyHours,
    deliveryModes: fromDbJsonArray(row.deliveryModesJson) as TeachingMode[],
    motivation: row.motivation,
    documentPath: row.documentPath,
    status: row.status,
    mailDispatchStatus: row.mailDispatchStatus,
    reviewedBy: row.reviewedBy,
    reviewNote: row.reviewNote,
    convertedTutorId: row.convertedTutorId,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export interface CreateVolunteerApplicationInput {
  fullName: string;
  email: string;
  phone?: string | null;
  cityId?: string | null;
  areaId?: string | null;
  gender?: Gender | null;
  subjectIds?: string[];
  levelIds?: string[];
  weeklyHours?: number | null;
  deliveryModes?: TeachingMode[];
  motivation?: string | null;
  documentPath?: string | null;
}

export async function createVolunteerApplication(
  db: Executor,
  input: CreateVolunteerApplicationInput,
): Promise<VolunteerApplicationRecord> {
  // The CV goes into the private bucket, never a public URL (FR-33.4, SEC-24).
  if (input.documentPath) assertPrivateStoragePath(input.documentPath);

  const id = newId();
  await db.insert(volunteerApplications).values({
    id,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone ?? null,
    cityId: input.cityId ?? null,
    areaId: input.areaId ?? null,
    gender: input.gender ?? null,
    subjectsJson: toDbJson(input.subjectIds ?? []) ?? '[]',
    levelsJson: toDbJson(input.levelIds ?? []) ?? '[]',
    weeklyHours: input.weeklyHours ?? null,
    deliveryModesJson: toDbJson(input.deliveryModes ?? []) ?? '[]',
    motivation: input.motivation ?? null,
    documentPath: input.documentPath ?? null,
    status: 'received',
    mailDispatchStatus: 'pending',
    createdAt: nowIso(),
  });

  return getVolunteerApplicationOrThrow(db, id);
}

export async function findVolunteerApplication(
  db: Executor,
  id: string,
): Promise<VolunteerApplicationRecord | null> {
  const rows = await db
    .select()
    .from(volunteerApplications)
    .where(eq(volunteerApplications.id, id))
    .limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getVolunteerApplicationOrThrow(
  db: Executor,
  id: string,
): Promise<VolunteerApplicationRecord> {
  const found = await findVolunteerApplication(db, id);
  if (!found) throw new NotFoundError('volunteer application', id);
  return found;
}

/** Administrator review queue, oldest first. */
export async function listByStatus(
  db: Executor,
  status: VolunteerStatus,
): Promise<VolunteerApplicationRecord[]> {
  const rows = await db
    .select()
    .from(volunteerApplications)
    .where(eq(volunteerApplications.status, status))
    .orderBy(volunteerApplications.createdAt);
  return rows.map(toDomain);
}

/** Duplicate-application lookup, newest first. */
export async function listByEmail(
  db: Executor,
  email: string,
): Promise<VolunteerApplicationRecord[]> {
  const rows = await db
    .select()
    .from(volunteerApplications)
    .where(eq(volunteerApplications.email, email))
    .orderBy(desc(volunteerApplications.createdAt));
  return rows.map(toDomain);
}

export async function recordMailDispatch(
  db: Executor,
  id: string,
  outcome: MailDispatchStatus,
): Promise<VolunteerApplicationRecord> {
  await db
    .update(volunteerApplications)
    .set({ mailDispatchStatus: outcome })
    .where(eq(volunteerApplications.id, id));
  return getVolunteerApplicationOrThrow(db, id);
}

/**
 * Record a review decision.
 *
 * Reaching `verified` means the applicant passed §6.6 identity verification
 * against CNIC and academic documents — the same bar as a paid tutor. This
 * function records the outcome; it does not perform the check.
 */
export async function reviewApplication(
  db: Executor,
  id: string,
  input: {
    status: VolunteerStatus;
    reviewedBy: string;
    reviewNote?: string | null;
    convertedTutorId?: string | null;
  },
): Promise<VolunteerApplicationRecord> {
  await db
    .update(volunteerApplications)
    .set({
      status: input.status,
      reviewedBy: input.reviewedBy,
      reviewNote: input.reviewNote ?? null,
      convertedTutorId: input.convertedTutorId ?? null,
    })
    .where(eq(volunteerApplications.id, id));
  return getVolunteerApplicationOrThrow(db, id);
}

export async function deleteVolunteerApplication(db: Executor, id: string): Promise<void> {
  await db.delete(volunteerApplications).where(eq(volunteerApplications.id, id));
}
