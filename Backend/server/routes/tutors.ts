/**
 * Tutor onboarding endpoints — §6.4, §6.5, §6.29.2.
 *
 * Every route here is **tutor role + owner scoped**: `requireRole('tutor')`
 * establishes what kind of account is calling, and `requireOwnProfile`
 * establishes that it is calling about its own profile. Role alone would let
 * any tutor edit any other tutor's rates.
 *
 * ── What no route in this file can do ──────────────────────────────────────
 *  · Make a profile searchable. Creation is `draft`; submit reaches
 *    `pending_verification`; `approved` belongs to an administrator (FR-6.3).
 *  · Mark a claim verified. The schema in `/shared` has no such field, and the
 *    repository writes `asserted` unconditionally (§2.2).
 *  · Set a normalised hourly rate. It is computed on every write (§2.7).
 *  · Receive a file. Uploads go straight to private storage under a
 *    short-lived ticket; the handler records only a path (SEC-7).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';

import { fileAppealSchema, submitCnicSchema } from '../../shared/verification';
import { fileAppeal } from '../services/verification-appeals';
import { registerCnic } from '../services/verification';
import { buildPublicVerification } from '../services/verification';
import {
  availabilitySlotSchema,
  confirmDocumentSchema,
  safetyConstraintsSchema,
  subjectClaimSchema,
  tutorProfileCreateSchema,
  tutorProfileUpdateSchema,
  tutorRateSchema,
  uploadTicketRequestSchema,
} from '../../shared/tutor-onboarding';
import { SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import { requireAuth, requireRole } from '../middleware/auth';
import { findUserById } from '../repositories/users';
import { loadPublicTutorProfile } from '../repositories/public-profile';
import {
  addTutorDocument,
  deleteTutorDocument,
  findSafetyConstraints,
  findTutorProfileByUserId,
  getTutorProfileOrThrow,
  listTutorDocuments,
} from '../repositories/tutors';
import {
  deleteAvailability,
  deleteSubjectClaim,
  deleteTutorRate,
  getAvailabilityOrThrow,
  getSubjectClaimOrThrow,
  getTutorRateOrThrow,
  listAvailability,
  listSubjectClaims,
  listTutorRates,
} from '../repositories/tutor-onboarding';
import {
  OnboardingError,
  addAvailabilitySlot,
  addRate,
  addSubjectClaim,
  amendRate,
  amendSubjectClaim,
  createProfile,
  saveSafetyConstraints,
  submitForVerification,
  updateProfile,
} from '../services/tutor-onboarding';
import { UploadValidationError, getDocumentStorage } from '../services/storage';

/** 400 with the field-level detail a form needs. */
function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } },
  body: unknown,
  res: Response,
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    invalid(
      res,
      (parsed.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
    return null;
  }
  return parsed.data as T;
}

/**
 * Loads the caller's own tutor profile onto the request.
 *
 * Resolving from the token's subject rather than from a path parameter is what
 * makes every route below owner-scoped by construction: there is no `:tutorId`
 * to tamper with.
 */
async function requireOwnProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await findTutorProfileByUserId(req.db, req.auth!.userId);
    if (!profile) {
      res.status(404).json({
        error: { code: 'no_tutor_profile', message: 'You do not have a tutor profile yet.' },
      });
      return;
    }
    req.tutorProfileId = profile.id;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Confirms a child row belongs to the caller's profile.
 *
 * 404 rather than 403 for someone else's row, so ids cannot be enumerated by
 * watching status codes.
 */
function requireOwnChild<T extends { tutorId: string }>(
  load: (req: Request) => Promise<T>,
  entity: string,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const row = await load(req).catch(() => null);
      if (!row || row.tutorId !== req.tutorProfileId) {
        res.status(404).json({ error: { code: 'not_found', message: `No such ${entity}.` } });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

declare module 'express-serve-static-core' {
  interface Request {
    tutorProfileId?: string;
  }
}

export function createTutorRouter(): Router {
  const router = Router();
  const tutorOnly = [requireAuth, requireRole('tutor')] as const;
  const owned = [...tutorOnly, requireOwnProfile] as const;

  /* --- The one public route in this file --------------------------------- */

  /**
   * `GET /api/tutors/public/:slug` — the anonymous profile a family reads.
   *
   * Registered **before** the owner-scoped routes and outside `tutorOnly`,
   * because browsing requires no account (FR-1.6). It is safe to be anonymous
   * for one reason: `loadPublicTutorProfile` resolves the slug through the
   * searchable predicate, so an unapproved tutor is not found at all
   * (FR-6.3). The literal segment `public` cannot collide with the owner
   * routes below, all of which are literal names of their own.
   *
   * A missing tutor and an unapproved tutor return the identical 404 — see
   * the repository for why that matters.
   */
  router.get('/public/:slug', async (req, res, next) => {
    try {
      const profile = await loadPublicTutorProfile(req.db, req.params.slug);
      if (!profile) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such tutor.' } });
        return;
      }

      const verification = await buildPublicVerification(
        req.db,
        profile.tutor.id,
        profile.claims
          .filter((claim) => claim.claimStatus === 'verified')
          .map((claim) => ({
            name: [claim.subjectName, claim.levelName].filter(Boolean).join(' — '),
            ...(claim.expiresOn ? { expiresOn: claim.expiresOn } : {}),
          })),
      );

      res.json({ ...profile, verification });
    } catch (error) {
      next(error);
    }
  });

  /* --- Profile ----------------------------------------------------------- */

  router.post('/profile', ...tutorOnly, async (req, res, next) => {
    try {
      const input = parse(tutorProfileCreateSchema, req.body, res);
      if (!input) return;

      const existing = await findTutorProfileByUserId(req.db, req.auth!.userId);
      if (existing) {
        throw new OnboardingError(409, 'profile_exists', 'You already have a tutor profile.');
      }

      const user = await findUserById(req.db, req.auth!.userId);
      const profile = await createProfile(req.db, {
        ...input,
        userId: req.auth!.userId,
        displayName: user?.displayName ?? 'tutor',
      });

      // Always draft. Stated in the response so the tutor knows they are not
      // yet listed, rather than discovering it from an empty search.
      res.status(201).json({ profile, searchable: false });
    } catch (error) {
      next(error);
    }
  });

  router.get('/profile', ...owned, async (req, res, next) => {
    try {
      const profile = await getTutorProfileOrThrow(req.db, req.tutorProfileId!);
      res.json({ profile, searchable: profile.profileStatus === SEARCHABLE_PROFILE_STATUS });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/profile', ...owned, async (req, res, next) => {
    try {
      const input = parse(tutorProfileUpdateSchema, req.body, res);
      if (!input) return;
      const profile = await updateProfile(req.db, req.tutorProfileId!, input);
      res.json({ profile, searchable: profile.profileStatus === SEARCHABLE_PROFILE_STATUS });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Submit for verification.
   *
   * The furthest a tutor can move their own profile. It does not approve
   * anything and does not make the profile searchable (FR-6.3, decision 17).
   */
  router.post('/profile/submit', ...owned, async (req, res, next) => {
    try {
      const profile = await submitForVerification(req.db, req.tutorProfileId!);
      res.json({
        profile,
        searchable: false,
        message:
          'Submitted for verification. Your profile becomes searchable once the Ustaad.com ' +
          'team has checked your CNIC and academic documents.',
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- Subject claims ---------------------------------------------------- */

  router.get('/claims', ...owned, async (req, res, next) => {
    try {
      res.json({ claims: await listSubjectClaims(req.db, req.tutorProfileId!) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/claims', ...owned, async (req, res, next) => {
    try {
      const input = parse(subjectClaimSchema, req.body, res);
      if (!input) return;
      const claim = await addSubjectClaim(req.db, req.tutorProfileId!, input);
      // 'asserted'. Restated here because it is the point of the endpoint.
      res.status(201).json({ claim });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/claims/:id',
    ...owned,
    requireOwnChild((req) => getSubjectClaimOrThrow(req.db, String(req.params.id)), 'claim'),
    async (req, res, next) => {
      try {
        const input = parse(subjectClaimSchema.partial(), req.body, res);
        if (!input) return;
        const claim = await amendSubjectClaim(req.db, String(req.params.id), input);
        res.json({ claim });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/claims/:id',
    ...owned,
    requireOwnChild((req) => getSubjectClaimOrThrow(req.db, String(req.params.id)), 'claim'),
    async (req, res, next) => {
      try {
        await deleteSubjectClaim(req.db, String(req.params.id));
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Rates ------------------------------------------------------------- */

  router.get('/rates', ...owned, async (req, res, next) => {
    try {
      res.json({ rates: await listTutorRates(req.db, req.tutorProfileId!) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/rates', ...owned, async (req, res, next) => {
    try {
      const input = parse(tutorRateSchema, req.body, res);
      if (!input) return;
      const rate = await addRate(req.db, req.tutorProfileId!, input);
      res.status(201).json({ rate });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/rates/:id',
    ...owned,
    requireOwnChild((req) => getTutorRateOrThrow(req.db, String(req.params.id)), 'rate'),
    async (req, res, next) => {
      try {
        const input = parse(tutorRateSchema, req.body, res);
        if (!input) return;
        const rate = await amendRate(req.db, String(req.params.id), input);
        res.json({ rate });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/rates/:id',
    ...owned,
    requireOwnChild((req) => getTutorRateOrThrow(req.db, String(req.params.id)), 'rate'),
    async (req, res, next) => {
      try {
        await deleteTutorRate(req.db, String(req.params.id));
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Availability ------------------------------------------------------ */

  router.get('/availability', ...owned, async (req, res, next) => {
    try {
      res.json({ slots: await listAvailability(req.db, req.tutorProfileId!) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/availability', ...owned, async (req, res, next) => {
    try {
      const input = parse(availabilitySlotSchema, req.body, res);
      if (!input) return;
      const slot = await addAvailabilitySlot(req.db, req.tutorProfileId!, input);
      res.status(201).json({ slot });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    '/availability/:id',
    ...owned,
    requireOwnChild((req) => getAvailabilityOrThrow(req.db, String(req.params.id)), 'slot'),
    async (req, res, next) => {
      try {
        await deleteAvailability(req.db, String(req.params.id));
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Safety constraints — §6.29.2 -------------------------------------- */

  router.get('/safety', ...owned, async (req, res, next) => {
    try {
      const saved = await findSafetyConstraints(req.db, req.tutorProfileId!);
      res.json({
        safety: saved ?? {
          tutorId: req.tutorProfileId,
          femaleStudentsOnly: false,
          guardianPresenceRequired: false,
          restrictedAreaIds: [],
        },
        // Said plainly, because the difference between this and a preference is
        // the whole of SEC-19.
        enforcement:
          'These conditions are enforced by Ustaad.com. A booking that does not meet them ' +
          'is not created, and a decline you make under them is excluded from your ' +
          'confirmation rate.',
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/safety', ...owned, async (req, res, next) => {
    try {
      const input = parse(safetyConstraintsSchema, req.body, res);
      if (!input) return;
      const safety = await saveSafetyConstraints(req.db, req.tutorProfileId!, input);
      res.json({ safety });
    } catch (error) {
      next(error);
    }
  });

  /* --- Documents — SEC-7, NFR-9 ------------------------------------------ */

  router.get('/documents', ...owned, async (req, res, next) => {
    try {
      const documents = await listTutorDocuments(req.db, req.tutorProfileId!);
      // Paths only. A tutor may see that a document exists; the file itself is
      // opened through a signed URL scoped to an administrator (SEC-7).
      res.json({
        documents: documents.map((d) => ({
          id: d.id,
          docType: d.docType,
          uploadedAt: d.uploadedAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Ask for an upload ticket.
   *
   * The server never receives the file: it returns a short-lived signed URL and
   * the browser PUTs directly to private storage. A 5 MB CNIC image therefore
   * never enters a request body, a memory buffer, or a log line.
   */
  router.post('/documents/ticket', ...owned, async (req, res, next) => {
    try {
      const input = parse(uploadTicketRequestSchema, req.body, res);
      if (!input) return;

      const ticket = await getDocumentStorage().createUploadTicket({
        scope: 'tutors',
        ownerId: req.tutorProfileId!,
        kind: input.docType,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });

      res.status(201).json({ ticket });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        invalid(res, [{ path: 'file', message: error.message }]);
        return;
      }
      next(error);
    }
  });

  /** Record the path once the browser reports the upload finished. */
  router.post('/documents', ...owned, async (req, res, next) => {
    try {
      const input = parse(confirmDocumentSchema, req.body, res);
      if (!input) return;

      // The path must sit under this tutor's own prefix. Without this a tutor
      // could claim someone else's uploaded document as their own.
      if (!input.storagePath.startsWith(`tutors/${req.tutorProfileId}/`)) {
        res.status(400).json({
          error: { code: 'path_not_yours', message: 'That upload does not belong to you.' },
        });
        return;
      }

      const document = await addTutorDocument(req.db, {
        tutorId: req.tutorProfileId!,
        docType: input.docType,
        storagePath: input.storagePath,
      });

      res.status(201).json({
        document: { id: document.id, docType: document.docType, uploadedAt: document.uploadedAt },
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    '/documents/:id',
    ...owned,
    requireOwnChild(
      async (req) => {
        const docs = await listTutorDocuments(req.db, req.tutorProfileId!);
        const found = docs.find((d) => d.id === String(req.params.id));
        if (!found) throw new Error('not found');
        return found;
      },
      'document',
    ),
    async (req, res, next) => {
      try {
        await deleteTutorDocument(req.db, String(req.params.id));
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- CNIC — SEC-8, NFR-10, FR-28.7 ------------------------------------ */

  /**
   * Submit a CNIC number for duplicate detection.
   *
   * The number is hashed and discarded within the request. It is not stored,
   * not returned, and not logged — the response says only whether a person
   * needs to look at it. A duplicate is **flagged, never auto-rejected**: two
   * accounts on one identity document is usually fraud and occasionally a
   * failed first signup, and a machine cannot tell those apart (FR-28.7).
   */
  router.post('/cnic', ...owned, async (req, res, next) => {
    try {
      const input = parse(submitCnicSchema, req.body, res);
      if (!input) return;

      const result = await registerCnic(req.db, req.tutorProfileId!, input.cnic);

      res.status(201).json({
        recorded: true,
        // Deliberately not `collidingTutorIds`: another tutor's id is not this
        // tutor's business, and telling them would help an impersonator confirm
        // a hit. The administrator queue has the detail.
        underReview: result.duplicate,
        message: result.duplicate
          ? 'Recorded. This identity document is also registered to another profile, so the ' +
            'Ustaad.com team will review both before approving either.'
          : 'Recorded. Your CNIC number is stored only as a one-way hash.',
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- Verification and appeals — §6.28, decision 12 --------------------- */

  router.get('/verification', ...owned, async (req, res, next) => {
    try {
      res.json({ verification: await buildPublicVerification(req.db, req.tutorProfileId!) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Appeal a rejection or a failed competency verdict.
   *
   * An automated verdict affecting a livelihood is never final (decision 12).
   * Once per decision, after a seven-day cooling period (FR-28.3).
   */
  router.post('/appeals', ...owned, async (req, res, next) => {
    try {
      const input = parse(fileAppealSchema, req.body, res);
      if (!input) return;

      const result = await fileAppeal(req.db, {
        tutorId: req.tutorProfileId!,
        againstRecordId: input.againstRecordId,
        tutorReason: input.tutorReason,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
