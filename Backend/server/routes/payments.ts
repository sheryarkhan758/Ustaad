/**
 * Payment record endpoints — §6.31.
 *
 * **Every route here is record-keeping.** Nothing on this router processes a
 * payment, holds funds, acts as an escrow or moves money. There is no gateway
 * integration in this project and none is stubbed (§4.2, CLAUDE.md §2.6).
 *
 * The disclaimer in `PAYMENT_DISCLAIMER` is attached to every response, because
 * FR-31.10 and SEC-23 require the interface to state plainly, **at every point
 * where payment appears**, that Ustaad.com does not process or hold funds.
 * Putting it on the payload rather than trusting a front end to remember is the
 * only way that holds.
 */

import { Router, type Request, type Response } from 'express';

import { PAYMENT_STATUSES } from '../../shared/payment-status';
import { requireAuth, requireRole } from '../middleware/auth';
import { getBookingOrThrow } from '../repositories/bookings';
import { findPaymentRecord, listDisputesForRecord } from '../repositories/payments';
import { findTutorProfileByUserId } from '../repositories/tutors';
import {
  PAYMENT_DISCLAIMER,
  buildEngagementStatement,
  canViewPaymentRecords,
  listOpenDisputes,
  resolveDispute,
} from '../services/payment-records';
import {
  amendAgreedAmountSchema,
  raiseDisputeSchema,
  resolveDisputeSchema,
} from '../../shared/payments';
import {
  amendAgreedAmount,
  confirmReceivedByTutor,
  markPaidByFamily,
  raiseDispute,
} from '../services/payments';


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse<T>(schema: any, body: unknown, res: Response): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Please check the details you entered.',
        issues: parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      disclaimer: PAYMENT_DISCLAIMER,
    });
    return null;
  }
  return parsed.data as T;
}

interface Party {
  bookingId: string;
  isFamily: boolean;
  isTutor: boolean;
}

/**
 * Resolve the caller's relationship to a payment record.
 *
 * **403, not 404, for a third party.** Elsewhere in this codebase an outsider
 * gets 404 so that ids cannot be enumerated. Here the brief asks for 403 and it
 * is the right answer for a different reason: a payment record's id is only
 * ever obtained from a booking the caller already had access to, so there is no
 * enumeration to prevent, and 403 tells an honest caller their session is
 * wrong rather than that their data has vanished.
 */
async function resolveParty(req: Request, res: Response, bookingId: string): Promise<Party | null> {
  const viewer = { userId: req.auth!.userId, role: req.auth!.role };

  if (!(await canViewPaymentRecords(req.db, bookingId, viewer))) {
    res.status(403).json({
      error: {
        code: 'forbidden',
        message: 'Payment records are visible only to the two parties to the engagement.',
      },
      disclaimer: PAYMENT_DISCLAIMER,
    });
    return null;
  }

  const booking = await getBookingOrThrow(req.db, bookingId);
  const tutorProfile = await findTutorProfileByUserId(req.db, req.auth!.userId);

  return {
    bookingId,
    isFamily: booking.requestedByUserId === req.auth!.userId,
    isTutor: tutorProfile?.id === booking.tutorId,
  };
}

/** Loads a record and the caller's relationship to its booking. */
async function loadRecordAsParty(
  req: Request,
  res: Response,
): Promise<{ recordId: string; party: Party } | null> {
  const record = await findPaymentRecord(req.db, String(req.params.id));
  if (!record) {
    res.status(404).json({
      error: { code: 'not_found', message: 'No such payment record.' },
      disclaimer: PAYMENT_DISCLAIMER,
    });
    return null;
  }

  const party = await resolveParty(req, res, record.bookingId);
  if (!party) return null;
  return { recordId: record.id, party };
}

export function createPaymentRouter(): Router {
  const router = Router();

  /* --- The per-engagement statement — FR-31.8 ---------------------------- */

  /**
   * Every cycle on one engagement.
   *
   * The auditable trail §2.3 says the informal market lacks: what was agreed,
   * what each side acknowledged, and when.
   */
  router.get('/bookings/:bookingId', requireAuth, async (req, res, next) => {
    try {
      const bookingId = String(req.params.bookingId);
      const party = await resolveParty(req, res, bookingId);
      if (!party) return;

      res.json(await buildEngagementStatement(req.db, bookingId));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      const loaded = await loadRecordAsParty(req, res);
      if (!loaded) return;

      const record = await findPaymentRecord(req.db, loaded.recordId);
      res.json({
        record,
        disputes: await listDisputesForRecord(req.db, loaded.recordId),
        disclaimer: PAYMENT_DISCLAIMER,
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- Dual acknowledgement — FR-31.3, FR-31.4 --------------------------- */

  /**
   * The family marks it paid.
   *
   * One side of a two-sided record. Until the tutor confirms, this is a claim
   * and the interface says so.
   */
  router.post('/:id/mark-paid', requireAuth, async (req, res, next) => {
    try {
      const loaded = await loadRecordAsParty(req, res);
      if (!loaded) return;

      if (!loaded.party.isFamily) {
        res.status(403).json({
          error: {
            code: 'not_your_acknowledgement',
            message: 'Only the family who booked can mark a payment as made.',
          },
          disclaimer: PAYMENT_DISCLAIMER,
        });
        return;
      }

      const record = await markPaidByFamily(req.db, loaded.recordId, new Date());
      res.json({ record, disclaimer: PAYMENT_DISCLAIMER });
    } catch (error) {
      next(error);
    }
  });

  /** The tutor confirms receipt. Both present ⇒ settled (FR-31.4). */
  router.post('/:id/confirm-received', requireAuth, async (req, res, next) => {
    try {
      const loaded = await loadRecordAsParty(req, res);
      if (!loaded) return;

      if (!loaded.party.isTutor) {
        res.status(403).json({
          error: {
            code: 'not_your_acknowledgement',
            message: 'Only the tutor can confirm that a payment was received.',
          },
          disclaimer: PAYMENT_DISCLAIMER,
        });
        return;
      }

      const record = await confirmReceivedByTutor(req.db, loaded.recordId, new Date());
      res.json({ record, disclaimer: PAYMENT_DISCLAIMER });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Amend the agreed amount.
   *
   * Permitted only while the record is still one-sided. Once both parties have
   * acknowledged, the service throws and this returns **409** (FR-31.1).
   */
  router.patch('/:id', requireAuth, async (req, res, next) => {
    try {
      const loaded = await loadRecordAsParty(req, res);
      if (!loaded) return;

      const input = parse<{ agreedAmount: number }>(amendAgreedAmountSchema, req.body, res);
      if (!input) return;

      const record = await amendAgreedAmount(req.db, loaded.recordId, input.agreedAmount);
      res.json({ record, disclaimer: PAYMENT_DISCLAIMER });
    } catch (error) {
      next(error);
    }
  });

  /* --- Disputes — FR-31.5 to FR-31.7 ------------------------------------- */

  /** Either party may dispute a record, stating a reason (FR-31.5). */
  router.post('/:id/disputes', requireAuth, async (req, res, next) => {
    try {
      const loaded = await loadRecordAsParty(req, res);
      if (!loaded) return;

      if (!loaded.party.isFamily && !loaded.party.isTutor) {
        res.status(403).json({
          error: {
            code: 'forbidden',
            message: 'Only a party to the engagement may raise a dispute.',
          },
          disclaimer: PAYMENT_DISCLAIMER,
        });
        return;
      }

      const input = parse<{ reason: string; detail?: string }>(raiseDisputeSchema, req.body, res);
      if (!input) return;

      const result = await raiseDispute(req.db, {
        paymentRecordId: loaded.recordId,
        raisedBy: req.auth!.userId,
        raisedByParty: loaded.party.isTutor ? 'tutor' : 'family',
        reason: input.reason,
        detail: input.detail,
      });

      res.status(201).json({ ...result, disclaimer: PAYMENT_DISCLAIMER });
    } catch (error) {
      next(error);
    }
  });

  /* --- The administrator queue — FR-31.6, FR-31.7 ------------------------ */

  router.get('/admin/disputes', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const items = await listOpenDisputes(req.db);
      res.json({
        items: items.map((i) => ({
          disputeId: i.dispute.id,
          raisedByParty: i.dispute.raisedByParty,
          reason: i.dispute.reason,
          detail: i.dispute.detail,
          raisedAt: i.dispute.createdAt,
          // The full engagement record attached (FR-31.6).
          record: i.record,
        })),
        count: items.length,
        disclaimer: PAYMENT_DISCLAIMER,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/admin/disputes/:disputeId/resolve',
    requireAuth,
    requireRole('admin'),
    async (req, res, next) => {
      try {
        const input = parse<{ outcome: (typeof PAYMENT_STATUSES)[number]; reason: string }>(
          resolveDisputeSchema,
          req.body,
          res,
        );
        if (!input) return;

        const result = await resolveDispute(req.db, {
          disputeId: String(req.params.disputeId),
          adminUserId: req.auth!.userId,
          outcome: input.outcome,
          reason: input.reason,
        });

        res.json({ ...result, disclaimer: PAYMENT_DISCLAIMER });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
