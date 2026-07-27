/**
 * The Organisation module — §6.13, trimmed by decision 4.
 *
 * The scope, and what is deliberately absent, is documented at the top of
 * `shared/organisations.ts`. This module holds the four rules the schema cannot
 * express:
 *
 *  1. **An organisation cannot approve itself** (FR-6.11, §2.5). Approval is
 *     platform-owned and written only by `decideOrgApproval`, which is reachable
 *     only from the administrator route, and it is audited.
 *  2. **An unapproved organisation may not post.** Otherwise the approval gate
 *     buys nothing: an account could register, skip verification, and publish a
 *     vacancy that tutors answer.
 *  3. **Interest is idempotent.** FR-13.4 says one action; pressing the button
 *     twice is still one expression of interest, not two, and the unique index
 *     agrees. A repeat returns the existing row rather than an error, because
 *     from the tutor's side the outcome is identical either way.
 *  4. **Only the owning organisation reads its interest list.** A tutor's
 *     application to an academy is not public. The vacancy is (FR-13.6); who
 *     answered it is not.
 */

import type {
  CreateVacancyInput,
  DecideOrgApprovalInput,
  UpsertOrgProfileInput,
  VacancyStatus,
} from '../../shared/organisations';
import type { BrowseVacanciesQuery } from '../../shared/organisations';
import { SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import {
  type OrgProfileRecord,
  type VacancyInterestRecord,
  type VacancyRecord,
  browseOpenVacancies,
  findInterest,
  findOrgProfileByUserId,
  getOrgProfileOrThrow,
  getVacancyOrThrow,
  insertInterest,
  insertOrgProfile,
  insertVacancy,
  listInterestsForTutor,
  listInterestsForVacancy,
  listUnapprovedOrgProfiles,
  listVacanciesForOrg,
  setOrgApproval,
  setVacancyStatus,
  updateOrgProfile,
} from '../repositories/organisations';
import { findTutorProfileByUserId } from '../repositories/tutors';
import type { Executor } from '../repositories/_base';
import { appendAdminAction } from './audit';

export type { OrgProfileRecord, VacancyRecord, VacancyInterestRecord };

/** A deliberate, user-facing refusal. `errorHandler` renders the shape. */
export class OrganisationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OrganisationError';
  }
}

/* -------------------------------------------------------------------------
 * Profile — FR-13.1
 * ---------------------------------------------------------------------- */

/**
 * Create or edit the caller's own organisation profile.
 *
 * Editing an **approved** profile does not revoke approval. An academy that
 * corrects a phone number has not become unverified, and a rule that sent it
 * back to the queue would teach organisations not to correct anything. What an
 * edit cannot do is *grant* approval — `updateOrgProfile` does not carry the
 * approval columns at all.
 */
export async function upsertOwnOrgProfile(
  db: Executor,
  userId: string,
  input: UpsertOrgProfileInput,
): Promise<OrgProfileRecord> {
  const existing = await findOrgProfileByUserId(db, userId);
  return existing
    ? updateOrgProfile(db, existing.id, input)
    : insertOrgProfile(db, userId, input);
}

export async function readOwnOrgProfile(
  db: Executor,
  userId: string,
): Promise<OrgProfileRecord | null> {
  return findOrgProfileByUserId(db, userId);
}

/**
 * The public view of an organisation — FR-13.1.
 *
 * An unapproved organisation is **not found**, not "pending". A 404 rather than
 * a 403 keeps the endpoint from confirming that an account exists at an id the
 * caller guessed, which is the same reasoning `requireOwnership` uses.
 */
export async function readPublicOrgProfile(
  db: Executor,
  id: string,
): Promise<OrgProfileRecord | null> {
  const org = await getOrgProfileOrThrow(db, id).catch(() => null);
  if (!org || org.approvedAt === null) return null;
  return org;
}

/** The administrator approval queue (FR-6.11). */
export async function listOrgApprovalQueue(db: Executor): Promise<OrgProfileRecord[]> {
  return listUnapprovedOrgProfiles(db);
}

/**
 * Approve or reject, with a written reason, attributed and audited — FR-6.11,
 * FR-14.4, §2.5.
 *
 * The audit entry is what makes the approval a record rather than a column: it
 * names the administrator, the moment and the reasoning, and it cannot be
 * rewritten afterwards (§2.7).
 */
export async function decideOrgApproval(
  db: Executor,
  input: DecideOrgApprovalInput & { orgId: string; adminUserId: string; at?: Date },
): Promise<OrgProfileRecord> {
  const at = input.at ?? new Date();
  const before = await getOrgProfileOrThrow(db, input.orgId);

  const approved = input.decision === 'approved';
  const result = await setOrgApproval(db, input.orgId, {
    approvedAt: approved ? at : null,
    approvedBy: approved ? input.adminUserId : null,
  });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: approved ? 'organisation.approved' : 'organisation.rejected',
    targetType: 'org_profile',
    targetId: input.orgId,
    detailJson: {
      orgName: before.orgName,
      orgType: before.orgType,
      previouslyApproved: before.approvedAt !== null,
      reason: input.reason,
    },
  });

  return result;
}

/* -------------------------------------------------------------------------
 * Vacancies — FR-13.3, FR-13.6
 * ---------------------------------------------------------------------- */

/** Resolves the caller's organisation, refusing if it is not yet approved. */
async function requireApprovedOrg(db: Executor, userId: string): Promise<OrgProfileRecord> {
  const org = await findOrgProfileByUserId(db, userId);
  if (!org) {
    throw new OrganisationError(
      404,
      'org_profile_missing',
      'Create your organisation profile before posting a vacancy.',
    );
  }
  if (org.approvedAt === null) {
    throw new OrganisationError(
      403,
      'org_not_approved',
      'Your organisation is awaiting administrator approval. You can post vacancies once it is approved.',
    );
  }
  return org;
}

export async function postVacancy(
  db: Executor,
  userId: string,
  input: CreateVacancyInput,
): Promise<VacancyRecord> {
  const org = await requireApprovedOrg(db, userId);
  return insertVacancy(db, org.id, input);
}

export async function listOwnVacancies(db: Executor, userId: string): Promise<VacancyRecord[]> {
  const org = await requireApprovedOrg(db, userId);
  return listVacanciesForOrg(db, org.id);
}

/**
 * Close or reopen a vacancy the caller owns.
 *
 * The status is the only field a posted vacancy exposes to editing — see
 * `updateVacancyStatusSchema`. Ownership is proved against the resolved
 * organisation rather than against a body field.
 */
export async function changeVacancyStatus(
  db: Executor,
  userId: string,
  vacancyId: string,
  status: VacancyStatus,
): Promise<VacancyRecord> {
  const org = await requireApprovedOrg(db, userId);
  const vacancy = await getVacancyOrThrow(db, vacancyId);
  if (vacancy.orgId !== org.id) {
    // 404 rather than 403: a caller who does not own the row does not learn
    // that it exists.
    throw new OrganisationError(404, 'not_found', 'No such vacancy.');
  }
  return setVacancyStatus(db, vacancyId, status);
}

/** The public board — FR-13.6. Open vacancies from approved organisations only. */
export async function browseVacancies(
  db: Executor,
  query: BrowseVacanciesQuery,
): Promise<{ items: VacancyRecord[]; total: number }> {
  return browseOpenVacancies(db, query);
}

/* -------------------------------------------------------------------------
 * Interest — FR-13.4
 * ---------------------------------------------------------------------- */

/**
 * A tutor expresses interest in one action — FR-13.4.
 *
 * The tutor must be **searchable**, that is, identity-verified (FR-6.3). An
 * unverified tutor answering vacancies would route around the verification gate
 * to reach an audience: the organisation would receive a name the platform has
 * not checked, on a surface that implies it has. Verification is the product
 * (§2.5), and it applies on every path that reaches a person, not only search.
 */
export async function expressInterest(
  db: Executor,
  userId: string,
  vacancyId: string,
): Promise<{ interest: VacancyInterestRecord; alreadyExpressed: boolean }> {
  const tutor = await findTutorProfileByUserId(db, userId);
  if (!tutor) {
    throw new OrganisationError(
      404,
      'tutor_profile_missing',
      'Create your tutor profile before expressing interest in a vacancy.',
    );
  }
  if (tutor.profileStatus !== SEARCHABLE_PROFILE_STATUS) {
    throw new OrganisationError(
      403,
      'tutor_not_verified',
      'Your profile must complete identity verification before you can answer vacancies.',
    );
  }

  const vacancy = await getVacancyOrThrow(db, vacancyId);
  if (vacancy.status !== 'open') {
    throw new OrganisationError(409, 'vacancy_closed', 'This vacancy is no longer open.');
  }

  // Idempotent by design: one action, pressed twice, is still one expression of
  // interest. The unique index agrees; this avoids relying on catching its error.
  const existing = await findInterest(db, vacancyId, tutor.id);
  if (existing) return { interest: existing, alreadyExpressed: true };

  return { interest: await insertInterest(db, vacancyId, tutor.id), alreadyExpressed: false };
}

/**
 * Who answered one of the caller's vacancies.
 *
 * Read by the owning organisation only. There is no endpoint that changes an
 * interest's state — FR-13.5's shortlist pipeline is the applicant-tracking
 * system decision 4 removed.
 */
export async function listInterestInOwnVacancy(
  db: Executor,
  userId: string,
  vacancyId: string,
): Promise<VacancyInterestRecord[]> {
  const org = await requireApprovedOrg(db, userId);
  const vacancy = await getVacancyOrThrow(db, vacancyId);
  if (vacancy.orgId !== org.id) {
    throw new OrganisationError(404, 'not_found', 'No such vacancy.');
  }
  return listInterestsForVacancy(db, vacancyId);
}

/** What the calling tutor has answered. */
export async function listOwnInterests(
  db: Executor,
  userId: string,
): Promise<VacancyInterestRecord[]> {
  const tutor = await findTutorProfileByUserId(db, userId);
  if (!tutor) return [];
  return listInterestsForTutor(db, tutor.id);
}
