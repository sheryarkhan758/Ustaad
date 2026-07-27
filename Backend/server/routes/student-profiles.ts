/**
 * Student profile endpoints — §6.2, SEC-1.
 *
 * ── Every route here creates or reads a *profile*, never an account ────────
 * These are mounted under `/api/students`, alongside the progress ledger.
 * Nothing in this file issues a credential, a session or a token, and the
 * request schema has no ownership field — so "register my child as an adult"
 * is not a request that can be expressed, rather than one that is refused
 * (CLAUDE.md §2.3).
 *
 * ── Role decides ownership ─────────────────────────────────────────────────
 * A parent's POST produces a parent-owned profile; an adult student's produces
 * a self-owned one. `requireRole('parent', 'student')` is what makes that
 * determination possible, and the repository is what applies it.
 *
 * ── A stranger's profile is a 404, never a 403 ─────────────────────────────
 * 403 would confirm that the id names a real child. The reads here return 404
 * for both cases, which is the position `GET /api/students/:id/progress`
 * already takes.
 */

import { Router, type Response } from 'express';

import {
  createStudentProfileSchema,
  updateStudentProfileSchema,
  StudentProfileOwnershipError,
} from '../../shared/student-profile';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createStudentProfile,
  findOwnedStudentProfile,
  listStudentProfilesForUser,
  updateStudentProfile,
} from '../repositories/student-profiles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse<T>(schema: any, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data as T;

  res.status(400).json({
    error: {
      code: 'validation_failed',
      message: 'Please check the details you entered.',
      issues: result.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  });
  return null;
}

export function createStudentProfileRouter(): Router {
  const router = Router();
  const familyOnly = [requireAuth, requireRole('parent', 'student')] as const;

  /** Every learner this account is responsible for. */
  router.get('/', ...familyOnly, async (req, res, next) => {
    try {
      res.json({ items: await listStudentProfilesForUser(req.db, req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Add a learner.
   *
   * The copy a client shows here matters as much as the endpoint: this is
   * "add your child's details", not "create an account for your child". The
   * API makes the second one impossible; the interface should make it
   * unthinkable.
   */
  router.post('/', ...familyOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof createStudentProfileSchema.parse>>(
        createStudentProfileSchema,
        req.body,
        res,
      );
      if (!input) return;

      const profile = await createStudentProfile(
        req.db,
        {
          ...input,
          ownerUserId: req.auth!.userId,
          ownerRole: req.auth!.role === 'student' ? 'student' : 'parent',
        },
        new Date(),
      );

      res.status(201).json({ profile });
    } catch (error) {
      // The ownership guard is a safety rule, not a validation quibble: an
      // adult student entering a child's date of birth lands here.
      if (error instanceof StudentProfileOwnershipError) {
        res.status(400).json({ error: { code: 'invalid_ownership', message: error.message } });
        return;
      }
      next(error);
    }
  });

  router.get('/:id', ...familyOnly, async (req, res, next) => {
    try {
      const profile = await findOwnedStudentProfile(
        req.db,
        String(req.params.id),
        req.auth!.userId,
      );
      // Not 403. See the module header.
      if (!profile) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such student profile.' } });
        return;
      }
      res.json({ profile });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', ...familyOnly, async (req, res, next) => {
    try {
      const owned = await findOwnedStudentProfile(req.db, String(req.params.id), req.auth!.userId);
      if (!owned) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such student profile.' } });
        return;
      }

      const input = parse<ReturnType<typeof updateStudentProfileSchema.parse>>(
        updateStudentProfileSchema,
        req.body,
        res,
      );
      if (!input) return;

      await updateStudentProfile(req.db, owned.id, input);
      res.json({
        profile: await findOwnedStudentProfile(req.db, owned.id, req.auth!.userId),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
