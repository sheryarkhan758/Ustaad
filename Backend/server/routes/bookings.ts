/**
 * Booking endpoints — §6.8, §6.20, §6.30, §6.12.
 *
 * Handlers stay thin: parse, authorise, call a service, respond. Every rule —
 * the state machine, the safety constraints, the volunteer cap, the slot
 * uniqueness — lives in `server/services/`, so there is one place to read to
 * know what a booking can do.
 *
 * Ownership is checked on every route. A parent may act only on their own
 * student's bookings; a tutor only on bookings addressed to them. Both get
 * **404** for anything else, so booking ids cannot be enumerated by watching
 * status codes.
 */

import { Router, type Request, type Response } from 'express';

import {
  createBookingSchema,
  sessionNoteSchema,
  slotQuerySchema,
  transitionBookingSchema,
  trialFitCheckSchema,
} from '../../shared/booking';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  addSessionNote,
  addTrialFitCheck,
  findEngagementPreview,
  findTrialFitCheckForBooking,
  getBookingOrThrow,
  listBookingsForRequester,
  listBookingsForTutor,
  listSessionNotes,
} from '../repositories/bookings';
import type { BookingRecord } from '../repositories/bookings';
import { findTutorProfileByUserId } from '../repositories/tutors';
import { createBookingRequest } from '../services/booking-create';
import { transitionBooking } from '../services/bookings';
import { generateSlots } from '../services/slots';

function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse<T>(schema: any, body: unknown, res: Response): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    invalid(
      res,
      parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    );
    return null;
  }
  return parsed.data as T;
}

interface Party {
  booking: BookingRecord;
  isRequester: boolean;
  isTutor: boolean;
}

/**
 * Loads the booking and establishes which party the caller is.
 *
 * 404 for a booking that is not theirs, identical to one that does not exist.
 */
async function loadAsParty(req: Request, res: Response): Promise<Party | null> {
  const booking = await getBookingOrThrow(req.db, String(req.params.id)).catch(() => null);
  if (!booking) {
    res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
    return null;
  }

  const isRequester = booking.requestedByUserId === req.auth!.userId;
  const tutorProfile = await findTutorProfileByUserId(req.db, req.auth!.userId);
  const isTutor = tutorProfile?.id === booking.tutorId;

  if (!isRequester && !isTutor && req.auth!.role !== 'admin') {
    res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
    return null;
  }

  return { booking, isRequester, isTutor };
}

export function createBookingRouter(): Router {
  const router = Router();

  /* --- Slots — FR-8.3 ---------------------------------------------------- */

  /**
   * Free slots for a tutor. Public: a family compares availability before
   * logging in, and booking is what requires an account (FR-1.6).
   */
  router.get('/slots', async (req, res, next) => {
    try {
      const query = parse<ReturnType<typeof slotQuerySchema.parse>>(
        slotQuerySchema,
        req.query,
        res,
      );
      if (!query) return;

      const slots = await generateSlots(req.db, {
        tutorId: query.tutorId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        slotMinutes: query.slotMinutes,
        mode: query.mode,
      });

      res.json({ slots, count: slots.length });
    } catch (error) {
      next(error);
    }
  });

  /* --- Create — §6.30, all three engagement types ------------------------ */

  router.post('/', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof createBookingSchema.parse>>(
        createBookingSchema,
        req.body,
        res,
      );
      if (!input) return;

      const { booking } = await createBookingRequest(req.db, {
        ...input,
        requestedByUserId: req.auth!.userId,
      });

      res.status(201).json({ booking });
    } catch (error) {
      next(error);
    }
  });

  /* --- Read -------------------------------------------------------------- */

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      if (req.auth!.role === 'tutor') {
        const profile = await findTutorProfileByUserId(req.db, req.auth!.userId);
        res.json({ bookings: profile ? await listBookingsForTutor(req.db, profile.id) : [] });
        return;
      }
      res.json({ bookings: await listBookingsForRequester(req.db, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;
      res.json({ booking: party.booking });
    } catch (error) {
      next(error);
    }
  });

  /**
   * `GET /api/bookings/:id/engagement` — what the tutor decides on. FR-29.13.
   *
   * Area, student, guardian and timing, and **never the street address**: she
   * sees where in the city she would be travelling to before she commits, and
   * the doorstep only once she has (SEC-20, FR-29.9). `findEngagementPreview`
   * selects no address column, so this route has nothing to leak rather than a
   * field it must remember to strip.
   *
   * Both parties may read it. For the family it is a restatement of what they
   * submitted, which is worth showing them plainly — it is the basis on which
   * she will answer.
   */
  router.get('/:id/engagement', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;

      const engagement = await findEngagementPreview(req.db, party.booking.id);
      if (!engagement) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
        return;
      }

      res.json({ engagement });
    } catch (error) {
      next(error);
    }
  });

  /* --- Lifecycle — FR-8.4, enforced server-side -------------------------- */

  router.post('/:id/transition', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;

      const input = parse<ReturnType<typeof transitionBookingSchema.parse>>(
        transitionBookingSchema,
        req.body,
        res,
      );
      if (!input) return;

      // Only the tutor declines, and only she can claim a safety constraint —
      // the flag suppresses a statistic about her, so nobody else may set it.
      if (input.declineUnderSafetyConstraint && !party.isTutor) {
        res.status(403).json({
          error: {
            code: 'not_your_constraint',
            message: 'Only the tutor may decline under a safety constraint.',
          },
        });
        return;
      }

      const actor = party.isTutor ? 'tutor' : party.isRequester ? 'requester' : 'admin';

      // `assertTransition` throws BookingTransitionError, which carries a 409.
      const booking = await transitionBooking(req.db, {
        bookingId: party.booking.id,
        to: input.to,
        by: actor,
        at: new Date(),
        reason: input.reason,
        declineUnderSafetyConstraint: input.declineUnderSafetyConstraint,
      });

      res.json({ booking });
    } catch (error) {
      next(error);
    }
  });

  /* --- Trial fit check — §6.20, SEC-15, decision 11 ---------------------- */

  /**
   * **Private to the requester and administrators.** There is no route by which
   * a tutor can read one, and none may be added: a family that expects the
   * tutor to see this writes nothing candid, and a trial exists to find out
   * before committing to a month.
   */
  router.post('/:id/fit-check', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;

      if (!party.isRequester) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
        return;
      }
      if (!party.booking.isTrial) {
        res.status(409).json({
          error: {
            code: 'not_a_trial',
            message: 'A fit check follows a trial session.',
          },
        });
        return;
      }
      if (party.booking.status !== 'completed') {
        res.status(409).json({
          error: {
            code: 'trial_not_completed',
            message: 'Complete the trial session before submitting a fit check.',
          },
        });
        return;
      }

      const input = parse<ReturnType<typeof trialFitCheckSchema.parse>>(
        trialFitCheckSchema,
        req.body,
        res,
      );
      if (!input) return;

      const check = await addTrialFitCheck(req.db, {
        bookingId: party.booking.id,
        submittedBy: req.auth!.userId,
        ...input,
      });

      res.status(201).json({ fitCheck: check });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/fit-check', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;

      // The tutor is a party to the booking and still may not read this.
      if (!party.isRequester && req.auth!.role !== 'admin') {
        res.status(404).json({ error: { code: 'not_found', message: 'No such fit check.' } });
        return;
      }

      res.json({ fitCheck: await findTrialFitCheckForBooking(req.db, party.booking.id) });
    } catch (error) {
      next(error);
    }
  });

  /* --- Session notes — §6.12, FR-12.1 ------------------------------------ */

  router.post('/:id/notes', requireAuth, requireRole('tutor'), async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party || !party.isTutor) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such booking.' } });
        return;
      }
      if (party.booking.status !== 'completed') {
        res.status(409).json({
          error: {
            code: 'booking_not_completed',
            message: 'Session notes are logged after a completed session.',
          },
        });
        return;
      }

      const input = parse<ReturnType<typeof sessionNoteSchema.parse>>(
        sessionNoteSchema,
        req.body,
        res,
      );
      if (!input) return;

      const note = await addSessionNote(req.db, {
        bookingId: party.booking.id,
        tutorId: party.booking.tutorId,
        topicsCovered: input.topicsCovered,
        masteryRatings: input.masteryRatings,
        note: input.note ?? null,
      });

      res.status(201).json({ note });
    } catch (error) {
      next(error);
    }
  });

  /** The progress ledger. Both parties and administrators may read it. */
  router.get('/:id/notes', requireAuth, async (req, res, next) => {
    try {
      const party = await loadAsParty(req, res);
      if (!party) return;
      res.json({ notes: await listSessionNotes(req.db, party.booking.id) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
