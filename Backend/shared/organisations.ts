/**
 * The Organisation module — §6.13, trimmed by **decision 4**.
 *
 * > "The Organisation role is trimmed to search plus an interest-based vacancy
 * > board. Approximately one day of work rather than four, while fully
 * > satisfying the stated use case."
 *
 * ── What is in ─────────────────────────────────────────────────────────────
 *  · FR-13.1  Profile: name, type, location, description, contact — subject to
 *             the same administrator approval a tutor goes through (FR-6.11).
 *  · FR-13.2  The same search engine parents use. No separate code path: an
 *             organisation calls `GET /api/search` exactly as a parent does,
 *             which is what makes "full access to the same engine" true rather
 *             than approximately true.
 *  · FR-13.3  Post a vacancy.
 *  · FR-13.4  A tutor expresses interest **in a single action, with no cover
 *             letter.** That is the whole interaction.
 *  · FR-13.6  The vacancy list is publicly browsable.
 *  · FR-13.7  Organisations may read the unmet demand board as hiring
 *             intelligence — already suppression-aware (SEC-16).
 *
 * ── What is deliberately out ───────────────────────────────────────────────
 * **FR-13.5 is not built.** "Organisation views interested tutors and marks
 * them shortlisted, contacted or closed" is an applicant-tracking system, and
 * an applicant-tracking system is what decision 4 removed. The organisation can
 * see who expressed interest — that much is FR-13.4's whole point — but there
 * is no endpoint that moves an interest between states, because the moment
 * there is one, there is a pipeline, then stage history, then notes on
 * candidates, then rejection reasons, and the day becomes the four days
 * decision 4 declined to spend.
 *
 * The `vacancy_interests.status` column still carries the wider vocabulary,
 * because the table was migrated before the trim was applied and dropping a
 * column to prove a point is not worth a migration. Nothing writes anything but
 * `'expressed'`, and `server/organisations.flow.test.ts` asserts that no other
 * value can be reached through the API.
 */

import { z } from 'zod';

import { RATE_TYPES, TEACHING_MODES } from './rates';

export const ORG_TYPES = ['academy', 'school', 'tuition_centre', 'other'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const VACANCY_STATUSES = ['open', 'filled', 'closed'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

/**
 * The only status the API ever writes. See the module header: the remaining
 * values in the column's enum are the applicant-tracking states decision 4
 * removed, and no route can reach them.
 */
export const INTEREST_EXPRESSED = 'expressed' as const;

export const VACANCY_INTEREST_STATUSES = [
  'expressed',
  'shortlisted',
  'contacted',
  'closed',
] as const;
export type VacancyInterestStatus = (typeof VACANCY_INTEREST_STATUSES)[number];

/* -------------------------------------------------------------------------
 * Profile — FR-13.1
 * ---------------------------------------------------------------------- */

/**
 * Free text is bounded but never character-restricted: an academy's name may be
 * in Urdu script, in Roman Urdu, in English, or in all three (§2.10). Any
 * validation narrower than a length is a validation that rejects a real name.
 */
export const upsertOrgProfileSchema = z.object({
  orgName: z.string().trim().min(2).max(160),
  orgType: z.enum(ORG_TYPES),
  description: z.string().trim().max(4000).optional().nullable(),
  website: z.string().trim().url().max(300).optional().nullable(),
  cityId: z.string().min(1),
  /** Area is the finest granularity this project records (§4.2). */
  areaId: z.string().min(1).optional().nullable(),
  contactEmail: z.string().trim().email().max(254).optional().nullable(),
  contactPhone: z.string().trim().min(7).max(30).optional().nullable(),
});

export type UpsertOrgProfileInput = z.infer<typeof upsertOrgProfileSchema>;

/** Administrator approval, with a written reason, audited (FR-6.11, FR-14.4). */
export const decideOrgApprovalSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(15).max(2000),
});

export type DecideOrgApprovalInput = z.infer<typeof decideOrgApprovalSchema>;

/* -------------------------------------------------------------------------
 * Vacancies — FR-13.3, FR-13.6
 * ---------------------------------------------------------------------- */

/**
 * `rateOffered` is **integer paisa** (§2.1). It is optional because a vacancy
 * that says "negotiable" is a real vacancy, and forcing a number would produce
 * a fictional one.
 */
export const createVacancySchema = z.object({
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  boardId: z.string().min(1).optional().nullable(),
  mode: z.enum(TEACHING_MODES),
  rateOffered: z.number().int().positive().max(100_000_000).optional().nullable(),
  rateType: z.enum(RATE_TYPES).optional().nullable(),
  areaId: z.string().min(1).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
});

export type CreateVacancyInput = z.infer<typeof createVacancySchema>;

/**
 * The one mutation an organisation may make to a posted vacancy.
 *
 * Not a general edit: the curriculum, rate and area a tutor read before
 * expressing interest stay as they were read. Closing a vacancy is the honest
 * operation; rewriting one under the people who answered it is not.
 */
export const updateVacancyStatusSchema = z.object({
  status: z.enum(VACANCY_STATUSES),
});

/** Public browse (FR-13.6). Filters only over fields already on the row. */
export const browseVacanciesQuerySchema = z.object({
  subjectId: z.string().min(1).optional(),
  levelId: z.string().min(1).optional(),
  boardId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  mode: z.enum(TEACHING_MODES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BrowseVacanciesQuery = z.infer<typeof browseVacanciesQuerySchema>;

/**
 * FR-13.4 — "express interest in a single action, with no cover letter."
 *
 * The empty object is the requirement. There is no message field, no
 * availability field and no rate counter-offer, because each of those turns one
 * action into a form, and a form is what an organisation then has to read,
 * shortlist and reply to — the applicant-tracking system decision 4 removed.
 */
export const expressInterestSchema = z.object({});
