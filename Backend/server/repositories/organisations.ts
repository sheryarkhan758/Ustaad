/**
 * Organisation aggregate — §6.13, trimmed by decision 4.
 *
 * Three tables: `org_profiles`, `vacancies`, `vacancy_interests`. The scope of
 * the trim, and what is deliberately absent, is documented at the top of
 * `shared/organisations.ts`.
 *
 * Note what this module does **not** expose: there is no
 * `updateVacancyInterestStatus`. FR-13.5's shortlist pipeline is the
 * applicant-tracking system decision 4 removed, and the cheapest way to keep it
 * removed is for the function that would move an interest between states not to
 * exist. A route cannot call what was never written.
 */

import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { fromDbTimestamp, newId, nowIso } from '../../shared/db-values';
import type {
  CreateVacancyInput,
  OrgType,
  UpsertOrgProfileInput,
  VacancyInterestStatus,
  VacancyStatus,
} from '../../shared/organisations';
import { INTEREST_EXPRESSED } from '../../shared/organisations';
import type { BrowseVacanciesQuery } from '../../shared/organisations';
import type { TeachingMode, RateType } from '../../shared/rates';
import { orgProfiles, vacancies, vacancyInterests } from '../db/schema/admin';
import { type Executor, NotFoundError } from './_base';

/* -------------------------------------------------------------------------
 * Profile — FR-13.1
 * ---------------------------------------------------------------------- */

export interface OrgProfileRecord {
  id: string;
  userId: string;
  orgName: string;
  orgType: OrgType;
  description: string | null;
  website: string | null;
  cityId: string;
  areaId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Null until an administrator approves (FR-6.11). */
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
}

type StoredOrg = typeof orgProfiles.$inferSelect;

function toOrg(row: StoredOrg): OrgProfileRecord {
  return {
    id: row.id,
    userId: row.userId,
    orgName: row.orgName,
    orgType: row.orgType,
    description: row.description,
    website: row.website,
    cityId: row.cityId,
    areaId: row.areaId,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    approvedAt: fromDbTimestamp(row.approvedAt),
    approvedBy: row.approvedBy,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function findOrgProfile(db: Executor, id: string): Promise<OrgProfileRecord | null> {
  const rows = await db.select().from(orgProfiles).where(eq(orgProfiles.id, id)).limit(1);
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function getOrgProfileOrThrow(db: Executor, id: string): Promise<OrgProfileRecord> {
  const found = await findOrgProfile(db, id);
  if (!found) throw new NotFoundError('organisation profile', id);
  return found;
}

/** One profile per account — `org_profiles.user_id` is unique. */
export async function findOrgProfileByUserId(
  db: Executor,
  userId: string,
): Promise<OrgProfileRecord | null> {
  const rows = await db.select().from(orgProfiles).where(eq(orgProfiles.userId, userId)).limit(1);
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function insertOrgProfile(
  db: Executor,
  userId: string,
  input: UpsertOrgProfileInput,
): Promise<OrgProfileRecord> {
  const id = newId();
  await db.insert(orgProfiles).values({
    id,
    userId,
    orgName: input.orgName,
    orgType: input.orgType,
    description: input.description ?? null,
    website: input.website ?? null,
    cityId: input.cityId,
    areaId: input.areaId ?? null,
    contactEmail: input.contactEmail ?? null,
    contactPhone: input.contactPhone ?? null,
    approvedAt: null,
    approvedBy: null,
    createdAt: nowIso(),
  });
  return getOrgProfileOrThrow(db, id);
}

/**
 * Edit the descriptive fields. **`approvedAt` and `approvedBy` are not in the
 * set** — an organisation cannot approve itself, for the same reason a tutor
 * cannot (§2.5, FR-6.11). Approval is written only by `setOrgApproval`, which
 * only the administrator route reaches.
 */
export async function updateOrgProfile(
  db: Executor,
  id: string,
  input: UpsertOrgProfileInput,
): Promise<OrgProfileRecord> {
  await db
    .update(orgProfiles)
    .set({
      orgName: input.orgName,
      orgType: input.orgType,
      description: input.description ?? null,
      website: input.website ?? null,
      cityId: input.cityId,
      areaId: input.areaId ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
    })
    .where(eq(orgProfiles.id, id));
  return getOrgProfileOrThrow(db, id);
}

/** Written by the administrator path only. `null` on rejection. */
export async function setOrgApproval(
  db: Executor,
  id: string,
  approval: { approvedAt: Date | null; approvedBy: string | null },
): Promise<OrgProfileRecord> {
  await db
    .update(orgProfiles)
    .set({
      approvedAt: approval.approvedAt ? approval.approvedAt.toISOString() : null,
      approvedBy: approval.approvedBy,
    })
    .where(eq(orgProfiles.id, id));
  return getOrgProfileOrThrow(db, id);
}

/** The administrator approval queue, oldest first. */
export async function listUnapprovedOrgProfiles(db: Executor): Promise<OrgProfileRecord[]> {
  const rows = await db
    .select()
    .from(orgProfiles)
    .where(isNull(orgProfiles.approvedAt))
    .orderBy(orgProfiles.createdAt, orgProfiles.id);
  return rows.map(toOrg);
}

/* -------------------------------------------------------------------------
 * Vacancies — FR-13.3, FR-13.6
 * ---------------------------------------------------------------------- */

export interface VacancyRecord {
  id: string;
  orgId: string;
  subjectId: string;
  levelId: string;
  boardId: string | null;
  mode: TeachingMode;
  /** Integer paisa (§2.1). Null means the rate is negotiable. */
  rateOffered: number | null;
  rateType: RateType | null;
  areaId: string | null;
  description: string | null;
  status: VacancyStatus;
  createdAt: Date;
}

type StoredVacancy = typeof vacancies.$inferSelect;

function toVacancy(row: StoredVacancy): VacancyRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    subjectId: row.subjectId,
    levelId: row.levelId,
    boardId: row.boardId,
    mode: row.mode,
    rateOffered: row.rateOffered,
    rateType: row.rateType,
    areaId: row.areaId,
    description: row.description,
    status: row.status,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function insertVacancy(
  db: Executor,
  orgId: string,
  input: CreateVacancyInput,
): Promise<VacancyRecord> {
  const id = newId();
  await db.insert(vacancies).values({
    id,
    orgId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    boardId: input.boardId ?? null,
    mode: input.mode,
    rateOffered: input.rateOffered ?? null,
    rateType: input.rateType ?? null,
    areaId: input.areaId ?? null,
    description: input.description ?? null,
    status: 'open',
    createdAt: nowIso(),
  });
  return getVacancyOrThrow(db, id);
}

export async function findVacancy(db: Executor, id: string): Promise<VacancyRecord | null> {
  const rows = await db.select().from(vacancies).where(eq(vacancies.id, id)).limit(1);
  return rows[0] ? toVacancy(rows[0]) : null;
}

export async function getVacancyOrThrow(db: Executor, id: string): Promise<VacancyRecord> {
  const found = await findVacancy(db, id);
  if (!found) throw new NotFoundError('vacancy', id);
  return found;
}

export async function setVacancyStatus(
  db: Executor,
  id: string,
  status: VacancyStatus,
): Promise<VacancyRecord> {
  await db.update(vacancies).set({ status }).where(eq(vacancies.id, id));
  return getVacancyOrThrow(db, id);
}

/** Every vacancy an organisation has posted, whatever its status. */
export async function listVacanciesForOrg(db: Executor, orgId: string): Promise<VacancyRecord[]> {
  const rows = await db
    .select()
    .from(vacancies)
    .where(eq(vacancies.orgId, orgId))
    .orderBy(desc(vacancies.createdAt), vacancies.id);
  return rows.map(toVacancy);
}

/**
 * The public board — FR-13.6.
 *
 * **Only `open` vacancies, and only from approved organisations.** The second
 * half matters: `org_profiles` is subject to administrator approval (FR-6.11),
 * and a board that listed unapproved organisations would hand an unverified
 * account a public surface and a channel to tutors, which is the whole thing
 * approval exists to gate. The organisation ids are resolved first and the
 * vacancy query is filtered on them, rather than joined, so the predicate is a
 * plain `IN` that behaves identically in both dialects (§2.1).
 */
export async function browseOpenVacancies(
  db: Executor,
  query: BrowseVacanciesQuery,
): Promise<{ items: VacancyRecord[]; total: number }> {
  const approved = await db
    .select({ id: orgProfiles.id })
    .from(orgProfiles)
    .where(isNotNull(orgProfiles.approvedAt));
  const approvedIds = approved.map((row) => row.id);

  if (approvedIds.length === 0) return { items: [], total: 0 };

  const conditions = [eq(vacancies.status, 'open'), inArray(vacancies.orgId, approvedIds)];
  if (query.subjectId) conditions.push(eq(vacancies.subjectId, query.subjectId));
  if (query.levelId) conditions.push(eq(vacancies.levelId, query.levelId));
  if (query.boardId) conditions.push(eq(vacancies.boardId, query.boardId));
  if (query.areaId) conditions.push(eq(vacancies.areaId, query.areaId));
  if (query.mode) conditions.push(eq(vacancies.mode, query.mode));

  const rows = await db
    .select()
    .from(vacancies)
    .where(and(...conditions))
    .orderBy(desc(vacancies.createdAt), vacancies.id);

  return {
    items: rows.slice(query.offset, query.offset + query.limit).map(toVacancy),
    total: rows.length,
  };
}

/* -------------------------------------------------------------------------
 * Interest — FR-13.4
 * ---------------------------------------------------------------------- */

export interface VacancyInterestRecord {
  id: string;
  vacancyId: string;
  tutorId: string;
  status: VacancyInterestStatus;
  createdAt: Date;
}

type StoredInterest = typeof vacancyInterests.$inferSelect;

function toInterest(row: StoredInterest): VacancyInterestRecord {
  return {
    id: row.id,
    vacancyId: row.vacancyId,
    tutorId: row.tutorId,
    status: row.status,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

/**
 * One action, no cover letter (FR-13.4).
 *
 * The status is the constant `'expressed'` and is not a parameter. A caller
 * cannot pass `'shortlisted'` because there is nothing to pass it to.
 */
export async function insertInterest(
  db: Executor,
  vacancyId: string,
  tutorId: string,
): Promise<VacancyInterestRecord> {
  const id = newId();
  await db.insert(vacancyInterests).values({
    id,
    vacancyId,
    tutorId,
    status: INTEREST_EXPRESSED,
    createdAt: nowIso(),
  });
  const rows = await db
    .select()
    .from(vacancyInterests)
    .where(eq(vacancyInterests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('vacancy interest', id);
  return toInterest(row);
}

export async function findInterest(
  db: Executor,
  vacancyId: string,
  tutorId: string,
): Promise<VacancyInterestRecord | null> {
  const rows = await db
    .select()
    .from(vacancyInterests)
    .where(and(eq(vacancyInterests.vacancyId, vacancyId), eq(vacancyInterests.tutorId, tutorId)))
    .limit(1);
  return rows[0] ? toInterest(rows[0]) : null;
}

/** Who expressed interest in one vacancy. Read by the owning organisation. */
export async function listInterestsForVacancy(
  db: Executor,
  vacancyId: string,
): Promise<VacancyInterestRecord[]> {
  const rows = await db
    .select()
    .from(vacancyInterests)
    .where(eq(vacancyInterests.vacancyId, vacancyId))
    .orderBy(vacancyInterests.createdAt, vacancyInterests.id);
  return rows.map(toInterest);
}

/** What one tutor has applied to. Read by that tutor. */
export async function listInterestsForTutor(
  db: Executor,
  tutorId: string,
): Promise<VacancyInterestRecord[]> {
  const rows = await db
    .select()
    .from(vacancyInterests)
    .where(eq(vacancyInterests.tutorId, tutorId))
    .orderBy(desc(vacancyInterests.createdAt), vacancyInterests.id);
  return rows.map(toInterest);
}
