/**
 * Group tuition and the unmet demand board — §6.23, §6.24.
 *
 * Thin, per working rule 4: parse → authorise → call a service → respond.
 *
 * Two things a reader should be able to check quickly:
 *
 *  · **No endpoint accepts a per-head rate.** It comes from the tutor's own
 *    `tutor_rates` row (FR-23.3).
 *  · **No demand endpoint accepts a window.** `DEMAND_WINDOW_DAYS` is a
 *    constant, because two overlapping windows subtract to a single record.
 */

import { Router, type Response } from 'express';
import { z } from 'zod';

import { createGroupRequestSchema, proposeGroupSchema } from '../../shared/group-matching';
import { demandBoardQuerySchema } from '../../shared/unmet-demand';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createGroupRequest,
  previewMatches,
  proposeGroupToTutor,
  respondAsMember,
  respondAsTutor,
  viewProposal,
  withdrawGroupRequest,
} from '../services/group-matching';
import { readDemandBoard, readSupplyGaps } from '../services/unmet-demand';
import {
  findGroupRequest,
  listOpenGroupRequestsForUser,
  listProposalsForRequest,
  listProposalsForTutor,
  listProposalMembers,
} from '../repositories/groups';
import { findTutorProfileByUserId } from '../repositories/tutors';
import type { Executor } from '../repositories/_base';

function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: {
      code: 'validation_failed',
      message: 'Please check the details you entered.',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}

const memberResponseSchema = z.object({
  groupRequestId: z.string().min(1),
  decision: z.enum(['confirm', 'decline']),
});

const tutorResponseSchema = z.object({ decision: z.enum(['accept', 'decline']) });

export function createGroupRouter(): Router {
  const router = Router();

  /* --- Opting in — FR-23.1 ----------------------------------------------- */

  router.post('/requests', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const parsed = createGroupRequestSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      const request = await createGroupRequest(req.db, {
        ...parsed.data,
        requestedByUserId: req.auth!.userId,
      });

      res.status(201).json({ request });
    } catch (error) {
      next(error);
    }
  });

  router.get('/requests', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      res.json({ requests: await listOpenGroupRequestsForUser(req.db, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });

  router.delete(
    '/requests/:id',
    requireAuth,
    requireRole('parent', 'student'),
    async (req, res, next) => {
      try {
        await withdrawGroupRequest(req.db, {
          requestId: String(req.params.id),
          userId: req.auth!.userId,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- The deterministic grouping, with its reasons — FR-23.7 ------------ */

  router.get(
    '/requests/:id/matches',
    requireAuth,
    requireRole('parent', 'student'),
    async (req, res, next) => {
      try {
        const requestId = String(req.params.id);

        // Ownership before anything else: a match preview names other families'
        // first names and areas, so it is not a public surface (FR-23.8).
        const request = await findGroupRequest(req.db, requestId);
        const mine = await listOpenGroupRequestsForUser(req.db, req.auth!.userId);
        if (!request || !mine.some((r) => r.id === requestId)) {
          res.status(404).json({ error: { code: 'not_found', message: 'No such group request.' } });
          return;
        }

        const preview = await previewMatches(req.db, requestId);
        res.json({
          group: preview.group,
          members: preview.members,
          proposals: await listProposalsForRequest(req.db, requestId),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Proposing to a tutor — FR-23.3 ------------------------------------ */

  router.post('/proposals', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const parsed = proposeGroupSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      const view = await proposeGroupToTutor(req.db, {
        tutorId: parsed.data.tutorId,
        memberRequestIds: parsed.data.memberRequestIds,
        requestedByUserId: req.auth!.userId,
      });

      res.status(201).json(view);
    } catch (error) {
      next(error);
    }
  });

  /* --- A tutor's incoming proposals — FR-23.5 ---------------------------- */

  router.get('/proposals', requireAuth, requireRole('tutor'), async (req, res, next) => {
    try {
      const tutor = await findTutorProfileByUserId(req.db, req.auth!.userId);
      if (!tutor) {
        res.status(404).json({ error: { code: 'not_found', message: 'No tutor profile.' } });
        return;
      }
      res.json({ proposals: await listProposalsForTutor(req.db, tutor.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/proposals/:id', requireAuth, async (req, res, next) => {
    try {
      const proposalId = String(req.params.id);
      if (!(await maySeeProposal(req.db, req.auth!, proposalId))) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such group proposal.' } });
        return;
      }
      res.json(await viewProposal(req.db, proposalId, { full: true }));
    } catch (error) {
      next(error);
    }
  });

  /* --- Confirmation, from both sides — FR-23.4, FR-23.5 ------------------ */

  router.post(
    '/proposals/:id/respond',
    requireAuth,
    requireRole('parent', 'student'),
    async (req, res, next) => {
      try {
        const parsed = memberResponseSchema.safeParse(req.body);
        if (!parsed.success) return invalid(res, parsed.error);

        res.json(
          await respondAsMember(req.db, {
            proposalId: String(req.params.id),
            groupRequestId: parsed.data.groupRequestId,
            userId: req.auth!.userId,
            decision: parsed.data.decision,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/proposals/:id/tutor-response',
    requireAuth,
    requireRole('tutor'),
    async (req, res, next) => {
      try {
        const parsed = tutorResponseSchema.safeParse(req.body);
        if (!parsed.success) return invalid(res, parsed.error);

        const tutor = await findTutorProfileByUserId(req.db, req.auth!.userId);
        if (!tutor) {
          res.status(404).json({ error: { code: 'not_found', message: 'No tutor profile.' } });
          return;
        }

        res.json(
          await respondAsTutor(req.db, {
            proposalId: String(req.params.id),
            tutorId: tutor.id,
            decision: parsed.data.decision,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/** A proposal is visible to its tutor and to its member families. Nobody else. */
async function maySeeProposal(
  db: Executor,
  auth: { userId: string; role: string },
  proposalId: string,
): Promise<boolean> {
  if (auth.role === 'admin') return true;

  if (auth.role === 'tutor') {
    const tutor = await findTutorProfileByUserId(db, auth.userId);
    const proposals = tutor ? await listProposalsForTutor(db, tutor.id) : [];
    return proposals.some((p) => p.id === proposalId);
  }

  const members = await listProposalMembers(db, proposalId);
  const mine = await listOpenGroupRequestsForUser(db, auth.userId);
  const mineIds = new Set(mine.map((r) => r.id));
  return members.some((m) => mineIds.has(m.groupRequestId));
}

/* -------------------------------------------------------------------------
 * The unmet demand board — §6.24
 * ---------------------------------------------------------------------- */

export function createDemandRouter(): Router {
  const router = Router();

  /**
   * FR-24.3 — the tutor-facing board.
   *
   * Note the absence of a `windowDays`, a `since`, an `until`, a `limit` and an
   * `order`. Every one of those would let a caller vary the population between
   * two requests and read the difference. The window is fixed at thirty days
   * and the ordering is by size.
   *
   * Organisations read the same board as hiring intelligence (FR-13.7). They
   * are added to the existing gate rather than given an endpoint of their own:
   * the board carries no requester identity and suppresses cohorts below three
   * (SEC-16), so what makes it safe to show a tutor makes it safe to show an
   * academy, and one surface cannot drift from two.
   */
  router.get('/', requireAuth, requireRole('tutor', 'organisation', 'admin'), async (req, res, next) => {
    try {
      const parsed = demandBoardQuerySchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error);
      res.json(await readDemandBoard(req.db, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  /** FR-24.4 — the administrator supply-gap view, same suppression. */
  router.get('/supply-gaps', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = demandBoardQuerySchema.safeParse(req.query);
      if (!parsed.success) return invalid(res, parsed.error);
      res.json(await readSupplyGaps(req.db, parsed.data));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
