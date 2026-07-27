/**
 * Volunteer tutor programme — §6.33.
 *
 * `POST /api/volunteers` requires **no account** (FR-33.1). It is the one
 * unauthenticated write in this system that also sends mail, so it carries the
 * public-form rate limiter, the honeypot and time-on-form checks, and an
 * attachment whose bytes are sniffed rather than trusted (FR-33.8, SEC-24).
 *
 * Everything below it is administrator-only.
 */

import express, { Router, type Response } from 'express';
import { z } from 'zod';

import { assertNotAutomated } from '../../shared/anti-abuse';
import {
  VOLUNTEER_STATUSES,
  approveVolunteerSchema,
  reviewVolunteerSchema,
  submitVolunteerApplicationSchema,
} from '../../shared/volunteers';
import { requireAuth, requireRole } from '../middleware/auth';
import { createPublicFormLimiter } from '../middleware/rate-limit';
import {
  getVolunteerApplicationOrThrow,
  listByStatus,
} from '../repositories/volunteers';
import { getDocumentStorage } from '../services/storage';
import {
  approveVolunteer,
  findPriorApplications,
  reviewVolunteerApplication,
  submitVolunteerApplication,
} from '../services/volunteers';

/** A 5 MB PDF is ~6.7 MB of base64. Raised on this router only. */
const attachmentBodyParser = express.json({ limit: '8mb' });

function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: {
      code: 'validation_failed',
      message: 'Please check the details you entered.',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}

export function createVolunteerRouter(): Router {
  const router = Router();

  /* --- Apply — public, no account (FR-33.1, FR-33.2) --------------------- */

  router.post('/', createPublicFormLimiter(), attachmentBodyParser, async (req, res, next) => {
    try {
      const parsed = submitVolunteerApplicationSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      assertNotAutomated(parsed.data);

      const result = await submitVolunteerApplication(req.db, parsed.data);

      // The id and the acknowledgement. Never the row: it holds the phone
      // number the applicant just gave, and echoing it back to an
      // unauthenticated caller serves nobody.
      res.status(201).json({
        id: result.application.id,
        acknowledgement: result.acknowledgement,
        // Stated honestly. If the mail failed, the application is still safe,
        // and saying so is better than implying an email is on its way.
        mailDispatchStatus: result.application.mailDispatchStatus,
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- Administrator review ---------------------------------------------- */

  router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const status = z.enum(VOLUNTEER_STATUSES).safeParse(req.query.status);
      res.json({
        applications: await listByStatus(req.db, status.success ? status.data : 'received'),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const application = await getVolunteerApplicationOrThrow(
        req.db,
        String(req.params.id),
      ).catch(() => null);

      if (!application) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such application.' } });
        return;
      }

      // Short-lived, administrator-scoped, and never a path (FR-33.4, SEC-24).
      const documentUrl = application.documentPath
        ? await getDocumentStorage().createReadUrl(application.documentPath)
        : null;

      res.json({
        application,
        documentUrl,
        priorApplications: (await findPriorApplications(req.db, application.email))
          .filter((a) => a.id !== application.id)
          .map((a) => ({ id: a.id, status: a.status, createdAt: a.createdAt })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/review', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = reviewVolunteerSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      res.json({
        application: await reviewVolunteerApplication(req.db, {
          applicationId: String(req.params.id),
          adminUserId: req.auth!.userId,
          status: parsed.data.status,
          reviewNote: parsed.data.reviewNote,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Convert — FR-33.10.
   *
   * Creates the tutor account. It does **not** verify it: the response says so
   * explicitly, and the profile comes back as `draft`.
   */
  router.post('/:id/approve', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = approveVolunteerSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      const result = await approveVolunteer(req.db, {
        applicationId: String(req.params.id),
        adminUserId: req.auth!.userId,
        password: parsed.data.password,
        reviewNote: parsed.data.reviewNote,
      });

      res.status(201).json({
        tutorId: result.tutorId,
        profileStatus: result.profileStatus,
        nextStep: result.nextStep,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
