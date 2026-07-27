/**
 * Organisation routes — §6.13, trimmed by decision 4.
 *
 * Thin, as §5.4 requires: parse → authorise → call a service → respond. No SQL,
 * no `req.db` query, no business rule.
 *
 * ── FR-13.2 has no route here, on purpose ──────────────────────────────────
 * "Full access to the same tutor search engine available to parents." The way
 * to satisfy that is to add nothing: `GET /api/search` is already open to every
 * caller, so an organisation uses the identical endpoint, the identical
 * ranking, and the identical gender hard-filter. A second `/api/organisations/
 * search` would be a second code path that could drift from the first, and the
 * thing most likely to drift is the filter §2.4 forbids relaxing.
 */

import { Router, type Response } from 'express';

import {
  browseVacanciesQuerySchema,
  createVacancySchema,
  decideOrgApprovalSchema,
  updateVacancyStatusSchema,
  upsertOrgProfileSchema,
} from '../../shared/organisations';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  browseVacancies,
  changeVacancyStatus,
  decideOrgApproval,
  expressInterest,
  listInterestInOwnVacancy,
  listOrgApprovalQueue,
  listOwnInterests,
  listOwnVacancies,
  postVacancy,
  readOwnOrgProfile,
  readPublicOrgProfile,
  upsertOwnOrgProfile,
} from '../services/organisations';
import type { ZodTypeAny, z } from 'zod';

function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

/** Parses, or writes a 400 and returns `undefined`. */
function parse<S extends ZodTypeAny>(res: Response, schema: S, value: unknown): z.infer<S> | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data as z.infer<S>;
  invalid(
    res,
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
  return undefined;
}

export function createOrganisationRouter(): Router {
  const router = Router();

  /* --- Profile — FR-13.1 --------------------------------------------- */

  router.put('/me', requireAuth, requireRole('organisation'), async (req, res, next) => {
    try {
      const body = parse(res, upsertOrgProfileSchema, req.body);
      if (!body) return;
      res.json({ organisation: await upsertOwnOrgProfile(req.db, req.auth!.userId, body) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, requireRole('organisation'), async (req, res, next) => {
    try {
      const organisation = await readOwnOrgProfile(req.db, req.auth!.userId);
      if (!organisation) {
        res.status(404).json({
          error: { code: 'not_found', message: 'You have not created an organisation profile yet.' },
        });
        return;
      }
      res.json({ organisation });
    } catch (error) {
      next(error);
    }
  });

  /* --- Vacancies the caller owns — FR-13.3 --------------------------- */

  router.post('/me/vacancies', requireAuth, requireRole('organisation'), async (req, res, next) => {
    try {
      const body = parse(res, createVacancySchema, req.body);
      if (!body) return;
      res.status(201).json({ vacancy: await postVacancy(req.db, req.auth!.userId, body) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me/vacancies', requireAuth, requireRole('organisation'), async (req, res, next) => {
    try {
      const items = await listOwnVacancies(req.db, req.auth!.userId);
      res.json({ items, count: items.length });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/me/vacancies/:id',
    requireAuth,
    requireRole('organisation'),
    async (req, res, next) => {
      try {
        const body = parse(res, updateVacancyStatusSchema, req.body);
        if (!body) return;
        res.json({
          vacancy: await changeVacancyStatus(
            req.db,
            req.auth!.userId,
            String(req.params.id),
            body.status,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * Who answered — FR-13.4, read side.
   *
   * There is deliberately no PATCH counterpart. Marking an interest
   * shortlisted, contacted or closed is FR-13.5, the applicant-tracking system
   * decision 4 removed.
   */
  router.get(
    '/me/vacancies/:id/interests',
    requireAuth,
    requireRole('organisation'),
    async (req, res, next) => {
      try {
        const items = await listInterestInOwnVacancy(
          req.db,
          req.auth!.userId,
          String(req.params.id),
        );
        res.json({ items, count: items.length });
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Public organisation profile — FR-13.1 ------------------------- */

  router.get('/:id', async (req, res, next) => {
    try {
      const organisation = await readPublicOrgProfile(req.db, String(req.params.id));
      if (!organisation) {
        // Unapproved reads as absent, not as "pending": a 403 would confirm the
        // account exists to a caller who only guessed the id.
        res.status(404).json({ error: { code: 'not_found', message: 'No such organisation.' } });
        return;
      }
      res.json({ organisation });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * The public vacancy board and the tutor's side of it — FR-13.6, FR-13.4.
 *
 * Mounted separately at `/api/vacancies` because browsing is not an
 * organisation-scoped action: anyone may read the board, and it is a tutor who
 * expresses interest.
 */
export function createVacancyRouter(): Router {
  const router = Router();

  /** FR-13.6 — publicly browsable, no account required. */
  router.get('/', async (req, res, next) => {
    try {
      const query = parse(res, browseVacanciesQuerySchema, req.query);
      if (!query) return;
      const { items, total } = await browseVacancies(req.db, query);
      res.json({ items, total, limit: query.limit, offset: query.offset });
    } catch (error) {
      next(error);
    }
  });

  /** What the calling tutor has answered. Declared before `/:id`. */
  router.get('/interests/mine', requireAuth, requireRole('tutor'), async (req, res, next) => {
    try {
      const items = await listOwnInterests(req.db, req.auth!.userId);
      res.json({ items, count: items.length });
    } catch (error) {
      next(error);
    }
  });

  /**
   * FR-13.4 — express interest in a single action, with no cover letter.
   *
   * The request body is ignored entirely. Sending one changes nothing, which is
   * the point: there is no cover letter to send.
   *
   * Repeating the action returns 200 and the existing row rather than 201 or a
   * conflict — the tutor's intent was expressed either way, and an error would
   * only teach them to wonder whether it worked the first time.
   */
  router.post('/:id/interest', requireAuth, requireRole('tutor'), async (req, res, next) => {
    try {
      const { interest, alreadyExpressed } = await expressInterest(
        req.db,
        req.auth!.userId,
        String(req.params.id),
      );
      res.status(alreadyExpressed ? 200 : 201).json({ interest, alreadyExpressed });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * The administrator side of FR-6.11 — organisation approval.
 *
 * Mounted under `/api/admin/organisations`, beside the tutor verification queue,
 * because it is the same job: the platform, not a third party, deciding who may
 * appear (§2.5).
 */
export function createAdminOrganisationRouter(): Router {
  const router = Router();

  router.get('/', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const items = await listOrgApprovalQueue(req.db);
      res.json({ items, count: items.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/decision', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const body = parse(res, decideOrgApprovalSchema, req.body);
      if (!body) return;
      res.json({
        organisation: await decideOrgApproval(req.db, {
          ...body,
          orgId: String(req.params.id),
          adminUserId: req.auth!.userId,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
