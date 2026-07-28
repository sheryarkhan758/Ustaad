/**
 * Administrator routes — §6.14.
 *
 * The dashboard (FR-14.3) and the flag queue (FR-14.2). Every handler is
 * `requireRole('admin')`, and every resolution writes to the append-only log
 * through the service (FR-14.4).
 */

import { Router, type Response } from 'express';

import { FLAG_TARGET_TYPES, resolveFlagSchema } from '../../shared/moderation';
import type { FlagTargetType } from '../../shared/moderation';
import { requireAuth, requireRole } from '../middleware/auth';
import { getAdminDashboardCounts } from '../services/admin-dashboard';
import { readAuditLog } from '../services/audit';
import { listFlagHistory, listFlagQueue, resolveFlag } from '../services/flags';

function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

export function createAdminRouter(): Router {
  const router = Router();

  router.get('/dashboard', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      res.json({ counts: await getAdminDashboardCounts(req.db) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * `GET /api/admin/audit` — the log, read-only (FR-14.2, NFR-19).
   *
   * There is no PATCH and no DELETE beside it, and there is nothing to write
   * one against: `server/services/audit.ts` exports an append and three
   * readers, so the append-only property the interface displays is a fact about
   * the service rather than a claim the interface makes.
   */
  router.get('/audit', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const entries = await readAuditLog(req.db, {
        adminUserId: req.query.adminUserId ? String(req.query.adminUserId) : undefined,
        action: req.query.action ? String(req.query.action) : undefined,
        targetType: req.query.targetType ? String(req.query.targetType) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ entries, count: entries.length });
    } catch (error) {
      next(error);
    }
  });

  router.get('/flags', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const items = await listFlagQueue(req.db);
      res.json({ items, count: items.length });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The report history for one target — "has this been reported before?"
   *
   * Administrators only, like the queue itself. `docs/DATA_MODEL.md` records
   * `flags` as never visible to the target of the report: a tutor who could read
   * who reported her would be all the reason a family needs never to report.
   */
  router.get('/flags/:targetType/:targetId', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const targetType = String(req.params.targetType) as FlagTargetType;
      if (!(FLAG_TARGET_TYPES as readonly string[]).includes(targetType)) {
        return invalid(res, [{ path: 'targetType', message: 'Unknown flag target type.' }]);
      }
      const items = await listFlagHistory(req.db, targetType, String(req.params.targetId));
      res.json({ items, count: items.length });
    } catch (error) {
      next(error);
    }
  });

  router.post('/flags/:id/resolve', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const parsed = resolveFlagSchema.safeParse(req.body);
      if (!parsed.success) {
        return invalid(
          res,
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }

      res.json(
        await resolveFlag(req.db, {
          flagId: String(req.params.id),
          adminUserId: req.auth!.userId,
          decision: parsed.data.decision,
          reason: parsed.data.reason,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}