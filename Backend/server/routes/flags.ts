import { Router, type Response } from 'express';

import { createFlagSchema } from '../../shared/moderation';
import { requireAuth } from '../middleware/auth';
import { createFlag } from '../services/flags';

function invalid(res: Response, issues: { path: string; message: string }[]): void {
  res.status(400).json({
    error: { code: 'validation_failed', message: 'Please check the details you entered.', issues },
  });
}

export function createFlagsRouter(): Router {
  const router = Router();

  router.post('/', requireAuth, async (req, res, next) => {
    try {
      const parsed = createFlagSchema.safeParse(req.body);
      if (!parsed.success) {
        return invalid(
          res,
          parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        );
      }

      const flag = await createFlag(req.db, {
        ...parsed.data,
        reporterUserId: req.auth?.userId ?? null,
      });
      res.status(201).json({ flag });
    } catch (error) {
      next(error);
    }
  });

  return router;
}