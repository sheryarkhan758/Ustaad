/**
 * Tutor onboarding rules — §6.4, §6.5, §6.29.2.
 *
 * Three things live here rather than in a handler, because each is a rule that
 * must hold no matter which endpoint is calling:
 *
 *  1. **A profile never becomes searchable by being saved.** `draft` on create,
 *     `pending_verification` on submit, and `approved` only from an
 *     administrator path that does not exist in this module (FR-6.3, §6.6).
 *  2. **`normalisedHourlyAmount` is computed, never accepted.** Every rate
 *     write recomputes it from the rate's own fields via `shared/rates.ts`, so
 *     the comparable figure and the quoted figure cannot disagree (§2.7).
 *  3. **Safety constraints are enforcement inputs.** `resolveTutorConstraints`
 *     and `assertBookingSatisfiesTutorConstraints` are what the booking engine
 *     calls; they are not a profile section (SEC-19).
 */

import { resolveUniqueSlug } from '../../shared/slug';
import { normaliseHourlyAmount } from '../../shared/rates';
import { checkEngagementAgainstConstraints as checkEngagement } from '../../shared/tutor-onboarding';
import type {
  AvailabilitySlotInput,
  ProposedEngagement,
  PublishedSafetyConstraints,
  SafetyConstraintsInput,
  SubjectClaimInput,
  TutorProfileCreateInput,
  TutorProfileUpdateInput,
  TutorRateInput,
} from '../../shared/tutor-onboarding';
import { SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import type { ProfileStatus } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';
import {
  type AvailabilityRecord,
  type SubjectClaimRecord,
  type TutorRateRecord,
  findOverlappingSlots,
  insertAvailability,
  insertSubjectClaim,
  insertTutorRate,
  replaceTutorRate,
  updateSubjectClaim,
} from '../repositories/tutor-onboarding';
import {
  type TutorProfileRecord,
  type TutorSafetyRecord,
  createTutorProfile,
  findSafetyConstraints,
  findTutorProfileBySlug,
  getTutorProfileOrThrow,
  updateTutorProfileFields,
  upsertSafetyConstraints,
} from '../repositories/tutors';

export class OnboardingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OnboardingError';
    this.status = status;
    this.code = code;
  }
}

/* =========================================================================
 * Profile
 * ====================================================================== */

/**
 * Create a tutor profile.
 *
 * **Always `draft`.** There is no parameter for the status, so no request body
 * and no future caller can create a profile that is already searchable.
 */
export async function createProfile(
  db: Executor,
  input: TutorProfileCreateInput & { userId: string; displayName: string },
): Promise<TutorProfileRecord> {
  const slug = await resolveUniqueSlug(
    input.displayName,
    async (candidate) => (await findTutorProfileBySlug(db, candidate)) !== null,
  );

  return createTutorProfile(db, {
    userId: input.userId,
    gender: input.gender,
    cityId: input.cityId,
    slug,
    bio: input.bio ?? null,
    bioUr: input.bioUr ?? null,
    qualifications: input.qualifications ?? null,
    experienceYears: input.experienceYears,
    teachesAtHome: input.teachesAtHome,
    teachesOnline: input.teachesOnline,
    teachesAtOwnPlace: input.teachesAtOwnPlace,
    willingAreaIds: input.willingAreaIds,
    volunteer: input.volunteer,
    profileStatus: 'draft',
  });
}

/**
 * Amend a profile.
 *
 * `TutorProfileUpdateInput` has no `profileStatus` and no `slug`. The slug is
 * fixed at creation because it is a shared URL and a QR code (§6.21) —
 * regenerating it on a name edit would break every link already handed out.
 */
export async function updateProfile(
  db: Executor,
  tutorId: string,
  input: TutorProfileUpdateInput,
): Promise<TutorProfileRecord> {
  const existing = await getTutorProfileOrThrow(db, tutorId);

  // An approved profile that is edited goes back for review: the administrator
  // approved a particular set of claims and documents, not a blank cheque.
  const revertsToReview =
    existing.profileStatus === SEARCHABLE_PROFILE_STATUS &&
    (input.gender !== undefined || input.cityId !== undefined || input.qualifications !== undefined);

  return updateTutorProfileFields(db, tutorId, {
    ...input,
    ...(revertsToReview ? { profileStatus: 'under_review' as ProfileStatus } : {}),
  });
}

/**
 * Submit for verification — the only status change a tutor may make.
 *
 * Moves `draft` (or `more_info_needed`) to `pending_verification`. It does not
 * and cannot reach `approved`: only an administrator does that, against a CNIC
 * and academic documents, with the decision attributed and timestamped in the
 * append-only log (FR-6.3, FR-6.6, decision 17).
 */
export async function submitForVerification(
  db: Executor,
  tutorId: string,
): Promise<TutorProfileRecord> {
  const profile = await getTutorProfileOrThrow(db, tutorId);

  const submittable: ProfileStatus[] = ['draft', 'more_info_needed', 'rejected'];
  if (!submittable.includes(profile.profileStatus)) {
    throw new OnboardingError(
      409,
      'not_submittable',
      `A profile in "${profile.profileStatus}" cannot be submitted. ` +
        'It is already with the Ustaad.com team.',
    );
  }

  return updateTutorProfileFields(db, tutorId, { profileStatus: 'pending_verification' });
}

/* =========================================================================
 * Claims
 * ====================================================================== */

export async function addSubjectClaim(
  db: Executor,
  tutorId: string,
  input: SubjectClaimInput,
): Promise<SubjectClaimRecord> {
  return insertSubjectClaim(db, { tutorId, ...input });
}

export async function amendSubjectClaim(
  db: Executor,
  claimId: string,
  input: Partial<SubjectClaimInput>,
): Promise<SubjectClaimRecord> {
  return updateSubjectClaim(db, claimId, input);
}

/* =========================================================================
 * Rates
 * ====================================================================== */

/**
 * Compute the comparable figure and persist.
 *
 * `normaliseHourlyAmount` throws when a rate type's required fields are absent
 * rather than guessing — silently reading a single-session fee as a monthly one
 * understates it roughly thirteenfold and corrupts every published median
 * (§2.7, §6.19).
 */
function normalise(input: TutorRateInput): number {
  return normaliseHourlyAmount({
    rateType: input.rateType,
    amount: input.amount,
    sessionsPerWeek: input.sessionsPerWeek,
    minutesPerSession: input.minutesPerSession,
    perHeadAmount: input.perHeadAmount,
    groupSizeMax: input.groupSizeMax,
  });
}

export async function addRate(
  db: Executor,
  tutorId: string,
  input: TutorRateInput,
): Promise<TutorRateRecord> {
  return insertTutorRate(db, {
    tutorId,
    subjectId: input.subjectId,
    levelId: input.levelId,
    rateType: input.rateType,
    amount: input.amount,
    sessionsPerWeek: input.sessionsPerWeek,
    minutesPerSession: input.minutesPerSession,
    mode: input.mode,
    groupSizeMax: input.groupSizeMax,
    perHeadAmount: input.perHeadAmount,
    negotiable: input.negotiable,
    travelCharge: input.travelCharge,
    normalisedHourlyAmount: normalise(input),
  });
}

export async function amendRate(
  db: Executor,
  rateId: string,
  input: TutorRateInput,
): Promise<TutorRateRecord> {
  return replaceTutorRate(db, rateId, {
    subjectId: input.subjectId,
    levelId: input.levelId,
    rateType: input.rateType,
    amount: input.amount,
    sessionsPerWeek: input.sessionsPerWeek,
    minutesPerSession: input.minutesPerSession,
    mode: input.mode,
    groupSizeMax: input.groupSizeMax,
    perHeadAmount: input.perHeadAmount,
    negotiable: input.negotiable,
    travelCharge: input.travelCharge,
    normalisedHourlyAmount: normalise(input),
  });
}

/* =========================================================================
 * Availability
 * ====================================================================== */

export async function addAvailabilitySlot(
  db: Executor,
  tutorId: string,
  input: AvailabilitySlotInput,
): Promise<AvailabilityRecord> {
  const clashes = await findOverlappingSlots(
    db,
    tutorId,
    input.weekday,
    input.startTime,
    input.endTime,
  );

  if (clashes.length > 0) {
    const clash = clashes[0]!;
    throw new OnboardingError(
      409,
      'slot_overlap',
      `That slot overlaps one you already have on the same day ` +
        `(${clash.startTime}–${clash.endTime}).`,
    );
  }

  return insertAvailability(db, { tutorId, ...input });
}

/* =========================================================================
 * Safety constraints — the booking engine's inputs
 * ====================================================================== */

export async function saveSafetyConstraints(
  db: Executor,
  tutorId: string,
  input: SafetyConstraintsInput,
): Promise<TutorSafetyRecord> {
  return upsertSafetyConstraints(db, { tutorId, ...input });
}

/**
 * What the booking engine reads.
 *
 * A tutor with no saved row has no constraints, which is different from having
 * declined to answer — the default is permissive because the platform must not
 * invent a restriction on someone's behalf, in the same way it never pre-sets a
 * family's gender filter (FR-16.6).
 *
 * The shape is `PublishedSafetyConstraints` from `/shared`, and deliberately so:
 * this is the same object the public profile hands the browser, so the rule that
 * runs here and the rule that runs in the booking form cannot diverge.
 */
export type TutorConstraints = PublishedSafetyConstraints;

export async function resolveTutorConstraints(
  db: Executor,
  tutorId: string,
): Promise<TutorConstraints> {
  const saved = await findSafetyConstraints(db, tutorId);
  return {
    femaleStudentsOnly: saved?.femaleStudentsOnly ?? false,
    guardianPresenceRequired: saved?.guardianPresenceRequired ?? false,
    restrictedAreaIds: saved?.restrictedAreaIds ?? [],
  };
}

/*
 * The rule itself now lives in `shared/tutor-onboarding.ts`, and is re-exported
 * here so every existing caller keeps its import.
 *
 * It moved because the booking form has to run it too. A family should learn
 * that a tutor requires a guardian present while they can still answer the
 * question, not by having a completed form refused — and the only way for the
 * form's rule and the engine's rule to be the same rule is for there to be one
 * of them (§3, "pure logic shared with the client").
 */
export type { ConstraintViolation, ProposedEngagement } from '../../shared/tutor-onboarding';
export { checkEngagementAgainstConstraints } from '../../shared/tutor-onboarding';

/** @throws {OnboardingError} when any declared condition is not met. */
export async function assertBookingSatisfiesTutorConstraints(
  db: Executor,
  tutorId: string,
  engagement: ProposedEngagement,
): Promise<void> {
  const constraints = await resolveTutorConstraints(db, tutorId);
  const violations = checkEngagement(constraints, engagement);

  if (violations.length > 0) {
    throw new OnboardingError(
      409,
      'tutor_constraints_not_met',
      violations.map((v) => v.message).join(' '),
    );
  }
}
