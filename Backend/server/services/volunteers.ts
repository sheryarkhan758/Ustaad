/**
 * Volunteer tutor programme — §6.33, SEC-24, SEC-25.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FR-33.9: the order is the requirement
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. Store the attachment (validated, including its bytes).
 *   2. **Write `volunteer_applications`.**
 *   3. Dispatch the mail.
 *   4. Record the dispatch outcome against the row.
 *
 * EmailJS sends from a browser with a public key. It is free, it needs no mail
 * server, and it is the right tool for notifying a small team. It is not a
 * system of record. A monthly quota reached, a template renamed or a blocked
 * request would silently discard an application if the email were the only
 * artefact — and the applicant would never know, because from their side the
 * submission appeared to succeed. Someone who offered four hours a week and
 * heard nothing back concludes the platform ignored them.
 *
 * So the row exists before the mail is attempted, `dispatch` cannot throw, and
 * step 4 always runs. A failed send leaves a complete application with
 * `mail_dispatch_status = 'failed'`, which a retry sweep can find.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * FR-33.10: the flag never substitutes for verification
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `approveVolunteer` creates a tutor account with `volunteer_flag` set and
 * `profile_status = 'draft'`. It cannot create an approved one — `createProfile`
 * takes no status parameter. The volunteer then goes through §6.6 against a
 * CNIC and academic documents exactly as a paid tutor does, and only an
 * administrator moves them to `approved`.
 *
 * A volunteer is a stranger entering a family's home. Goodwill is not a
 * background check, and the fee is what differs, not the standard.
 */

import { eq } from 'drizzle-orm';

import { newId, nowIso } from '../../shared/db-values';
import type {
  ApproveVolunteerInput,
  ReviewVolunteerInput,
  SubmitVolunteerApplicationInput,
} from '../../shared/volunteers';
import { users } from '../db/schema/identity';
import {
  createVolunteerApplication,
  getVolunteerApplicationOrThrow,
  listByEmail,
  recordMailDispatch,
  reviewApplication,
  type VolunteerApplicationRecord,
} from '../repositories/volunteers';
import { setVolunteerCap } from '../repositories/tutors';
import type { Executor } from '../repositories/_base';
import { appendAdminAction } from './audit';
import { hashPassword } from './auth';
import { dispatch } from './mail';
import { getDocumentStorage } from './storage';
import { storeSubmittedFile } from './submitted-files';
import { createProfile } from './tutor-onboarding';

export class VolunteerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VolunteerError';
    this.status = status;
    this.code = code;
  }
}

export interface SubmitVolunteerResult {
  application: VolunteerApplicationRecord;
  /** What the applicant is told, in the response and in the mail (FR-33.7). */
  acknowledgement: string;
}

const RESPONSE_WINDOW = 'within five working days';

export async function submitVolunteerApplication(
  db: Executor,
  input: SubmitVolunteerApplicationInput,
): Promise<SubmitVolunteerResult> {
  /* --- 1. The document. Sniffed before anything is written (SEC-24). ----- */

  let documentPath: string | null = null;
  if (input.document) {
    // A random owner segment: the application id does not exist yet, and using
    // the email would put a contact address in a storage path.
    documentPath = await storeSubmittedFile({
      scope: 'volunteers',
      ownerId: newId(),
      kind: 'supporting-document',
      file: input.document,
    });
  }

  /* --- 2. The row. Before the mail. This is FR-33.9. --------------------- */

  const application = await createVolunteerApplication(db, {
    fullName: input.fullName,
    email: input.email,
    // Stored as typed, never normalised, and never written to a log (§2.2).
    phone: input.phone,
    cityId: input.cityId,
    areaId: input.areaId,
    gender: input.gender,
    subjectIds: input.subjectIds,
    levelIds: input.levelIds,
    weeklyHours: input.weeklyHours,
    deliveryModes: input.deliveryModes,
    // Any script, unchanged (§2.10).
    motivation: input.motivation ?? null,
    documentPath,
  });

  /* --- 3. Notify the team and acknowledge the applicant, together -------- */

  const acknowledgement =
    `Thank you for offering to volunteer. Your application has been recorded. ` +
    `An administrator will review it and contact you ${RESPONSE_WINDOW}. ` +
    `Volunteers are verified against a CNIC and academic documents on exactly the same ` +
    `basis as paid tutors before they can be booked.`;

  // A signed link, not the file and not a public path (FR-33.6, SEC-24). Short
  // lived by construction — if the administrator opens it late they ask again.
  let documentLink: string | null = null;
  if (documentPath) {
    documentLink = await getDocumentStorage()
      .createReadUrl(documentPath)
      .catch(() => null);
  }

  const result = await dispatch([
    {
      templateEnvVar: 'EMAILJS_TEMPLATE_VOLUNTEER',
      params: {
        application_id: application.id,
        full_name: application.fullName,
        email: application.email,
        phone: application.phone,
        city: application.cityId,
        area: application.areaId,
        gender: application.gender,
        subjects: application.subjectIds.join(', '),
        levels: application.levelIds.join(', '),
        weekly_hours: application.weeklyHours,
        delivery_modes: application.deliveryModes.join(', '),
        motivation: application.motivation,
        document_link: documentLink ?? '(no document attached)',
      },
    },
    {
      // FR-33.7 — the applicant hears what happens next, in the same dispatch.
      templateEnvVar: 'EMAILJS_TEMPLATE_VOLUNTEER_ACK',
      params: {
        to_email: application.email,
        to_name: application.fullName,
        application_id: application.id,
        next_steps: acknowledgement,
        response_window: RESPONSE_WINDOW,
      },
    },
  ]);

  /* --- 4. Record what happened to the mail -------------------------------- */

  await recordMailDispatch(db, application.id, result.status);

  return {
    application: await getVolunteerApplicationOrThrow(db, application.id),
    acknowledgement,
  };
}

/* -------------------------------------------------------------------------
 * Administrator review
 * ---------------------------------------------------------------------- */

export async function reviewVolunteerApplication(
  db: Executor,
  input: { applicationId: string; adminUserId: string } & ReviewVolunteerInput,
): Promise<VolunteerApplicationRecord> {
  const before = await getVolunteerApplicationOrThrow(db, input.applicationId).catch(() => null);
  if (!before) throw new VolunteerError(404, 'not_found', 'No such volunteer application.');

  if (before.status === 'active') {
    throw new VolunteerError(
      409,
      'already_converted',
      'This volunteer already has a tutor account. Manage it through the tutor record.',
    );
  }

  const updated = await reviewApplication(db, input.applicationId, {
    status: input.status,
    reviewedBy: input.adminUserId,
    reviewNote: input.reviewNote,
    convertedTutorId: before.convertedTutorId,
  });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'volunteer_application.reviewed',
    targetType: 'volunteer_applications',
    targetId: input.applicationId,
    // The application id, the transition and the reason. Never the phone
    // number and never the email (§2.2).
    detailJson: { from: before.status, to: input.status, reason: input.reviewNote },
  });

  return updated;
}

export interface ApproveVolunteerResult {
  application: VolunteerApplicationRecord;
  tutorId: string;
  userId: string;
  /**
   * Always `draft`. Stated in the response so the administrator sees that
   * approving the application did **not** approve the tutor.
   */
  profileStatus: string;
  nextStep: string;
}

/**
 * Convert an approved volunteer into a tutor account — FR-33.10.
 *
 * Requires the supporting document: optional at submission, mandatory before
 * approval (FR-33.3). Somebody is about to be routed towards families' homes;
 * the decision is made on evidence or it is not made.
 */
export async function approveVolunteer(
  db: Executor,
  input: { applicationId: string; adminUserId: string } & ApproveVolunteerInput,
): Promise<ApproveVolunteerResult> {
  const application = await getVolunteerApplicationOrThrow(db, input.applicationId).catch(
    () => null,
  );
  if (!application) throw new VolunteerError(404, 'not_found', 'No such volunteer application.');

  if (application.convertedTutorId) {
    throw new VolunteerError(409, 'already_converted', 'This volunteer already has an account.');
  }
  if (!application.documentPath) {
    throw new VolunteerError(
      409,
      'document_required',
      'A supporting document is required before approval (FR-33.3).',
    );
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, application.email))
    .limit(1);
  if (existing.length > 0) {
    throw new VolunteerError(
      409,
      'email_in_use',
      'An account already exists for that email address.',
    );
  }

  /* --- The account ------------------------------------------------------- */

  const userId = newId();
  await db.insert(users).values({
    id: userId,
    email: application.email,
    passwordHash: await hashPassword(input.password),
    role: 'tutor',
    displayName: application.fullName,
    gender: application.gender,
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  /* --- The profile. `draft`, because createProfile cannot make it anything
   *     else — there is no status parameter to pass (FR-6.3). -------------- */

  const profile = await createProfile(db, {
    userId,
    displayName: application.fullName,
    // The submission schema admits only `male` or `female`, because a tutor's
    // gender is a hard search filter (§2.4) and there is no third bucket a
    // family's stated preference could match. Guarded rather than cast: the
    // stored column is wider than the form.
    gender: application.gender === 'male' ? 'male' : 'female',
    cityId: application.cityId ?? 'karachi',
    experienceYears: 0,
    teachesAtHome: application.deliveryModes.includes('home'),
    teachesOnline: application.deliveryModes.includes('online'),
    teachesAtOwnPlace: application.deliveryModes.includes('own_place'),
    willingAreaIds: application.areaId ? [application.areaId] : [],
    // The flag. It records that no fee is charged. It records nothing about
    // whether this person has been checked.
    volunteer: true,
  });

  // The declared cap, enforced at booking (FR-33.11).
  await setVolunteerCap(db, profile.id, application.weeklyHours);

  const updated = await reviewApplication(db, input.applicationId, {
    // Not `active` yet: the volunteer becomes active when verification
    // approves them, not when this runs.
    status: 'verified',
    reviewedBy: input.adminUserId,
    reviewNote: input.reviewNote,
    convertedTutorId: profile.id,
  });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'volunteer_application.converted',
    targetType: 'volunteer_applications',
    targetId: input.applicationId,
    detailJson: {
      tutorId: profile.id,
      // Recorded explicitly so the log shows that conversion did not verify.
      profileStatus: profile.profileStatus,
      volunteerFlag: true,
      verificationRequired: true,
      reason: input.reviewNote,
    },
  });

  return {
    application: updated,
    tutorId: profile.id,
    userId,
    profileStatus: profile.profileStatus,
    nextStep:
      'The account exists but is not searchable. It enters §6.6 verification against a CNIC ' +
      'and academic documents on the same basis as any paid tutor.',
  };
}

/** Duplicate-application lookup for the administrator queue. */
export async function findPriorApplications(
  db: Executor,
  email: string,
): Promise<VolunteerApplicationRecord[]> {
  return listByEmail(db, email);
}
