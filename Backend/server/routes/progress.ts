/**
 * The progress ledger route — §6.12.
 *
 * Thin, as §5.4 requires: parse → authorise → call a service → respond. The
 * ownership read goes through `server/repositories/progress.ts`; this handler
 * builds no query of its own.
 */

import { Router } from 'express';

import { requireAuth } from '../middleware/auth';
import { findStudentProfileForLedger } from '../repositories/progress';
import { buildProgressLedger } from '../services/progress-ledger';

export function createProgressRouter(): Router {
  const router = Router();

  /**
   * Readable by the owning parent, by an adult student managing their own
   * profile, and by administrators (FR-12.2).
   *
   * A student profile that does not exist and one belonging to another family
   * both return **404**. Returning 403 for the second would turn the endpoint
   * into an existence oracle: a parent could enumerate other families' student
   * ids by watching which status came back. This is the same rule
   * `requireOwnership` applies, spelled out here because the resolver needs the
   * row it is authorising against.
   *
   * Administrators are allowed deliberately — a safety concern or a dispute
   * about a tutor's session notes cannot be investigated otherwise — and the
   * data model records `session_notes` as parties-and-admin for that reason.
   */
  router.get('/:studentProfileId/progress', requireAuth, async (req, res, next) => {
    try {
      const studentProfileId = String(req.params.studentProfileId);
      const student = await findStudentProfileForLedger(req.db, studentProfileId);

      const notFound = (): void => {
        res.status(404).json({ error: { code: 'not_found', message: 'No such student profile.' } });
      };

      if (!student) return notFound();

      const auth = req.auth!;
      const mayRead =
        auth.role === 'admin' ||
        student.parentUserId === auth.userId ||
        student.selfUserId === auth.userId;
      if (!mayRead) return notFound();

      const ledger = await buildProgressLedger(req.db, studentProfileId);
      if (!ledger) return notFound();

      res.json({ ledger });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
