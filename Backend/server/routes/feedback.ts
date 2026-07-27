/**
 * Platform feedback — §6.32.
 *
 * `POST /api/feedback` is reachable **with or without an account** (FR-32.6).
 * `authenticate` has already run app-wide, so `req.auth` is populated when a
 * cookie was presented and absent otherwise; this route reads it rather than
 * requiring it.
 *
 * Everything else here is administrator-only. There is no tutor-facing route
 * and no public read of any kind — FR-32.10 means feedback appears on no public
 * surface, and the cheapest way to guarantee that is for no endpoint to exist
 * that could serve one.
 */

import express, { Router, type Response } from 'express';
import { z } from 'zod';

import { assertNotAutomated } from '../../shared/anti-abuse';
import { feedbackQueueQuerySchema, submitFeedbackSchema, triageFeedbackSchema } from '../../shared/feedback';
import { requireAuth, requireRole } from '../middleware/auth';
import { createPublicFormLimiter } from '../middleware/rate-limit';
import {
  getFeedbackOrThrow,
  listSafetyConcerns,
  listTriageQueue,
} from '../repositories/feedback';
import { submitFeedback, triageFeedback } from '../services/feedback';
import { getDocumentStorage } from '../services/storage';
import type { Lang } from '../db/schema/reference';

/**
 * A 5 MB attachment is about 6.7 MB of base64, so the app-wide 1 MB JSON limit
 * would reject it. Raised **only on this router**: every other endpoint keeps
 * the tighter default, which is the point of setting it here rather than
 * globally.
 */
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

/** The interface language, from the request rather than the body (FR-32.4). */
function localeOf(header: string | undefined): Lang | null {
  if (!header) return null;
  return /(^|[,;\s])ur\b/i.test(header) ? 'ur' : 'en';
}

export function createFeedbackRouter(): Router {
  const router = Router();

  /* --- Submit — FR-32.2, FR-32.4, FR-32.5, FR-32.6 ----------------------- */

  router.post('/', createPublicFormLimiter(), attachmentBodyParser, async (req, res, next) => {
    try {
      const parsed = submitFeedbackSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      // Cheap, client-supplied, and not a security boundary — the rate limiter
      // above is. See `shared/anti-abuse.ts`.
      assertNotAutomated(parsed.data);

      const result = await submitFeedback(req.db, parsed.data, {
        // Null when nobody is signed in, and then `role` is null too. An
        // anonymous record carries no identity fields at all (FR-32.6).
        userId: req.auth?.userId ?? null,
        role: req.auth?.role ?? null,
        locale: localeOf(req.get('accept-language')),
        appVersion: req.get('x-app-version') ?? process.env.APP_VERSION ?? null,
      });

      res.status(201).json({
        id: result.feedback.id,
        acknowledgement: result.acknowledgement,
        // So the client can show "escalated" rather than a generic thank-you.
        escalated: result.feedback.safetyConcernFlag,
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- The administrator queue — FR-32.7 --------------------------------- */

  router.get('/queue', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = feedbackQueueQuerySchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error);

      // Safety concerns are their own list and jump the queue (FR-32.8).
      const items = parsed.data.safetyOnly
        ? await listSafetyConcerns(req.db)
        : await listTriageQueue(req.db, parsed.data.status);

      res.json({ items: items.slice(0, parsed.data.limit) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const feedback = await getFeedbackOrThrow(req.db, String(req.params.id)).catch(() => null);
      if (!feedback) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such feedback.' } });
        return;
      }

      // The attachment is served by a short-lived signed URL, never a path
      // (FR-32.5, SEC-7).
      const attachmentUrl = feedback.attachmentPath
        ? await getDocumentStorage().createReadUrl(feedback.attachmentPath)
        : null;

      res.json({ feedback, attachmentUrl });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/triage', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = triageFeedbackSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      res.json({
        feedback: await triageFeedback(req.db, {
          feedbackId: String(req.params.id),
          adminUserId: req.auth!.userId,
          status: parsed.data.status,
          dispositionNote: parsed.data.dispositionNote,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
