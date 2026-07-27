/**
 * Review endpoints — §6.9.
 *
 * `POST /api/reviews` does three things and returns: check the booking is
 * completed and the caller owns it, insert the review, enqueue the analysis.
 * **The model call is never awaited here** (FR-9.3) — a family posting a review
 * waits on one insert.
 */

import { Router, type Response } from 'express';

import { createReviewSchema } from '../../shared/review-analysis';
import { requireAuth, requireRole } from '../middleware/auth';
import { getBookingOrThrow } from '../repositories/bookings';
import {
  createReview,
  findReview,
  listPublicReviewsForTutor,
  listSafetyConcernReviews,
} from '../repositories/reviews';
import { enqueueReviewAnalysis } from '../services/review-queue';

function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

export function createReviewRouter(): Router {
  const router = Router();

  /* --- Submit — FR-9.1, FR-9.2, FR-9.3 ----------------------------------- */

  router.post('/', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const parsed = createReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        invalid(
          res,
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
        return;
      }

      const booking = await getBookingOrThrow(req.db, parsed.data.bookingId).catch(() => null);

      // A booking that is not theirs and one that does not exist give the same
      // answer, so booking ids cannot be enumerated.
      if (!booking || booking.requestedByUserId !== req.auth!.userId) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
        return;
      }

      // FR-9.1. A review is traceable to a real interaction (SEC-5).
      if (booking.status !== 'completed') {
        res.status(409).json({
          error: {
            code: 'booking_not_completed',
            message: 'You can review a tutor once the session is complete.',
          },
        });
        return;
      }

      let review;
      try {
        review = await createReview(req.db, {
          bookingId: booking.id,
          tutorId: booking.tutorId,
          reviewerUserId: req.auth!.userId,
          reviewerRole: req.auth!.role === 'student' ? 'student' : 'parent',
          rating: parsed.data.rating,
          text: parsed.data.text ?? null,
        });
      } catch (error) {
        // FR-9.1: one review per booking, enforced by a UNIQUE index.
        const message = error instanceof Error ? error.message : '';
        if (/UNIQUE|unique|duplicate key/i.test(message)) {
          res.status(409).json({
            error: {
              code: 'already_reviewed',
              message: 'You have already reviewed this booking.',
            },
          });
          return;
        }
        throw error;
      }

      // Fire and forget. The response goes out first (FR-9.3).
      enqueueReviewAnalysis(req.db, review.id);

      res.status(201).json({ review, analysisStatus: 'pending' });
    } catch (error) {
      next(error);
    }
  });

  /* --- Public listing — FR-9.7, FR-9.8 ----------------------------------- */

  /**
   * A tutor's reviews. Unauthenticated: browsing needs no login (FR-1.6).
   *
   * Safety-flagged reviews are absent, not redacted (SEC-9). Generic reviews
   * are present — FR-9.6 down-weights them in ranking and does not hide them.
   */
  router.get('/tutor/:tutorId', async (req, res, next) => {
    try {
      const reviews = await listPublicReviewsForTutor(req.db, String(req.params.tutorId));
      res.json({
        reviews: reviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          // Byte-for-byte as written. Never translated (§2.10).
          text: r.text,
          reviewerRole: r.reviewerRole,
          createdAt: r.createdAt,
          // FR-9.7: the disagreement between the stars and the words is shown.
          contradiction: r.contradiction,
          dimensions: r.dimensions,
          analysisStatus: r.analysisStatus,
          /*
           * FR-9.6 — the client cannot mark a review as low-signal unless it
           * is told which ones are. Withholding the flag here would silently
           * turn "down-weighted and visibly marked" into "shown as though it
           * carried the same weight as a detailed one", which is the failure
           * mode FR-9.6 exists to prevent.
           */
          lowSignal: r.lowSignal,
          credibilityWeight: r.credibilityWeight,
          // FR-9.5 — how many sessions this family actually had with her.
          completedSessions: r.completedSessions,
        })),
        count: reviews.length,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      const review = await findReview(req.db, String(req.params.id));
      if (!review || review.reviewerUserId !== req.auth!.userId) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such review.' } });
        return;
      }
      res.json({ review });
    } catch (error) {
      next(error);
    }
  });

  /* --- The administrator safety queue — FR-9.8, SEC-9 -------------------- */

  router.get('/admin/safety-queue', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const items = await listSafetyConcernReviews(req.db);
      res.json({
        items: items.map((i) => ({
          reviewId: i.review.id,
          tutorId: i.review.tutorId,
          rating: i.review.rating,
          text: i.review.text,
          reason: i.reason,
          createdAt: i.review.createdAt,
        })),
        count: items.length,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
