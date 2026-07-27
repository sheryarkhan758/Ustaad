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
import type { TeachingMode } from '../../shared/rates';
import type {
  AvailabilitySlotInput,
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
 */
export interface TutorConstraints {
  femaleStudentsOnly: boolean;
  guardianPresenceRequired: boolean;
  restrictedAreaIds: ReadonlySet<string>;
}

export async function resolveTutorConstraints(
  db: Executor,
  tutorId: string,
): Promise<TutorConstraints> {
  const saved = await findSafetyConstraints(db, tutorId);
  return {
    femaleStudentsOnly: saved?.femaleStudentsOnly ?? false,
    guardianPresenceRequired: saved?.guardianPresenceRequired ?? false,
    restrictedAreaIds: new Set(saved?.restrictedAreaIds ?? []),
  };
}

export interface ProposedEngagement {
  studentGender: 'female' | 'male' | 'other' | null;
  areaId: string | null;
  guardianPresenceOffered: boolean;
  mode: TeachingMode;
}

export interface ConstraintViolation {
  constraint: 'female_students_only' | 'guardian_presence_required' | 'restricted_area';
  message: string;
}

/**
 * Check a proposed booking against the tutor's declared conditions.
 *
 * Called by the booking engine **before** a request reaches her, so that a
 * booking she would have to decline on safety grounds is never created. That
 * matters beyond tidiness: SEC-21 excludes safety declines from her
 * confirmation-rate statistic precisely so she is not penalised for them, and
 * the cleanest way to honour that is for the decline not to be necessary.
 *
 * Returns violations rather than throwing, so the caller can decide between
 * refusing the booking and hiding the tutor from the result set.
 */
export function checkEngagementAgainstConstraints(
  constraints: TutorConstraints,
  engagement: ProposedEngagement,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  if (constraints.femaleStudentsOnly && engagement.studentGender !== 'female') {
    violations.push({
      constraint: 'female_students_only',
      message: 'This tutor teaches female students only.',
    });
  }

  if (constraints.guardianPresenceRequired && !engagement.guardianPresenceOffered) {
    violations.push({
      constraint: 'guardian_presence_required',
      message: 'This tutor requires a guardian to be present during the session.',
    });
  }

  // Only relevant when she would have to travel.
  if (
    engagement.mode === 'home' &&
    engagement.areaId !== null &&
    constraints.restrictedAreaIds.has(engagement.areaId)
  ) {
    violations.push({
      constraint: 'restricted_area',
      message: 'This tutor does not travel to that area.',
    });
  }

  return violations;
}

/** @throws {OnboardingError} when any declared condition is not met. */
export async function assertBookingSatisfiesTutorConstraints(
  db: Executor,
  tutorId: string,
  engagement: ProposedEngagement,
): Promise<void> {
  const constraints = await resolveTutorConstraints(db, tutorId);
  const violations = checkEngagementAgainstConstraints(constraints, engagement);

  if (violations.length > 0) {
    throw new OnboardingError(
      409,
      'tutor_constraints_not_met',
      violations.map((v) => v.message).join(' '),
    );
  }
}
