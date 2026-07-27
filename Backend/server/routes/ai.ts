/**
 * AI endpoints — §7.
 *
 * Thin, per working rule 4: parse → authorise → call a component → respond.
 * Every hard constraint these endpoints touch lives in the component beneath
 * them, not here and not in a prompt.
 *
 * Note what is **absent**: no endpoint accepts a model name, a temperature, a
 * prompt, a system message or a token cap from the client. The AI surface a
 * browser can reach is four verbs over stored data. Keys are server-side only
 * (NFR-5, SEC-12).
 */

import { Router, type Response } from 'express';

import {
  generateStudyPlanSchema,
  intakeTurnSchema,
  startIntakeSchema,
  startVerificationSchema,
  submitAnswersSchema,
} from '../../shared/ai-requests';
import { z } from 'zod';

import { requireAuth, requireRole } from '../middleware/auth';
import { listStudyPlansForStudent } from '../repositories/study-plans';
import { findOwnedStudentProfile } from '../repositories/student-profiles';
import {
  startVerificationAttempt,
  submitVerificationAnswers,
} from '../ai/agents/competency-verification';
import { runIntakeTurn, startIntakeSession } from '../ai/agents/diagnostic-intake';
import { readBudget } from '../ai/budget';
import { generateStudyPlan } from '../ai/study-plan';
import { searchTutors } from '../repositories/search';
import { findTutorProfileByUserId } from '../repositories/tutors';
import { narrateRanking } from '../ai/narration';

function invalid(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: {
      code: 'validation_failed',
      message: 'Please check the details you entered.',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}

export function createAiRouter(): Router {
  const router = Router();

  /* --- Agent 1: diagnostic intake (§6.10) -------------------------------- */

  router.post('/intake', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const parsed = startIntakeSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      const sessionId = await startIntakeSession(req.db, {
        userId: req.auth!.userId,
        studentProfileId: parsed.data.studentProfileId,
        goal: parsed.data.goal,
      });

      res.status(201).json({ sessionId });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/intake/:sessionId/turn',
    requireAuth,
    requireRole('parent', 'student'),
    async (req, res, next) => {
      try {
        const parsed = intakeTurnSchema.safeParse(req.body);
        if (!parsed.success) return invalid(res, parsed.error);

        const result = await runIntakeTurn(req.db, {
          sessionId: String(req.params.sessionId),
          message: parsed.data.message,
          subjectId: parsed.data.subjectId,
          constraints: parsed.data.constraints,
        });

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Agent 2: competency verification (§6.11) -------------------------- */

  router.post('/verification', requireAuth, requireRole('tutor'), async (req, res, next) => {
    try {
      const parsed = startVerificationSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      // Ownership server-side (NFR-6). A tutor may only assess their own claim.
      const tutor = await findTutorProfileByUserId(req.db, req.auth!.userId);
      if (!tutor) {
        res.status(404).json({ error: { code: 'not_found', message: 'No tutor profile.' } });
        return;
      }

      const result = await startVerificationAttempt(req.db, {
        tutorId: tutor.id,
        claimId: parsed.data.claimId,
        topicId: parsed.data.topicId,
        isAppeal: parsed.data.isAppeal,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/verification/:sessionId/answers',
    requireAuth,
    requireRole('tutor'),
    async (req, res, next) => {
      try {
        const parsed = submitAnswersSchema.safeParse(req.body);
        if (!parsed.success) return invalid(res, parsed.error);

        const tutor = await findTutorProfileByUserId(req.db, req.auth!.userId);
        if (!tutor) {
          res.status(404).json({ error: { code: 'not_found', message: 'No tutor profile.' } });
          return;
        }

        const result = await submitVerificationAnswers(req.db, {
          sessionId: String(req.params.sessionId),
          tutorId: tutor.id,
          answers: parsed.data.answers,
        });

        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  /* --- Study plan (§6.26) ------------------------------------------------ */

  router.post('/study-plan', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const parsed = generateStudyPlanSchema.safeParse(req.body);
      if (!parsed.success) return invalid(res, parsed.error);

      const result = await generateStudyPlan(req.db, {
        diagnosticId: parsed.data.diagnosticId,
        startDate: parsed.data.startDate,
        targetDate: parsed.data.targetDate,
        levelId: parsed.data.levelId,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * `GET /api/ai/study-plans?studentProfileId=` — the plans already generated.
   *
   * §6.25's countdown view and §6.26's timeline both need to *read* a plan
   * that was generated earlier; without this the only way to see one was to
   * generate another, which costs a model call to display something already
   * stored (§7.4). Reads no provider and returns the stored JSON as written.
   *
   * Scoped to profiles this account owns. A plan names a child's weaknesses,
   * so a stranger's plan is a 404 rather than a 403 — the same position the
   * progress ledger takes.
   */
  router.get('/study-plans', requireAuth, requireRole('parent', 'student'), async (req, res, next) => {
    try {
      const studentProfileId = String(req.query.studentProfileId ?? '');
      if (!studentProfileId) {
        res.status(400).json({
          error: { code: 'validation_failed', message: 'studentProfileId is required.' },
        });
        return;
      }

      const owned = await findOwnedStudentProfile(req.db, studentProfileId, req.auth!.userId);
      if (!owned) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such student profile.' } });
        return;
      }

      res.json({ items: await listStudyPlansForStudent(req.db, studentProfileId) });
    } catch (error) {
      next(error);
    }
  });

  /* --- Ranking narration (§6.22) ------------------------------------------
   *
   * The breakdown is **recomputed server-side**, never accepted from the body.
   * If a client could post a breakdown, it could hand the model any figures it
   * liked and get them back as prose over the platform's name — which is the
   * FR-22.4 rule defeated by the transport rather than by the model.
   */

  router.get('/narration/:tutorId/:topicId', requireAuth, async (req, res, next) => {
    try {
      const lang = req.query.lang === 'ur' ? 'ur' : 'en';

      // The same deterministic ranking the family saw, for this one topic.
      const response = await searchTutors(req.db, {
        topicIds: [String(req.params.topicId)],
        genderPreference: 'no_preference',
        includeAdjacentAreas: false,
        limit: 500,
        offset: 0,
      } as Parameters<typeof searchTutors>[1]);

      const hit = response.results.find((r) => r.tutor.id === req.params.tutorId);
      if (!hit) {
        res.status(404).json({
          error: { code: 'not_found', message: 'No published ranking for this tutor and topic.' },
        });
        return;
      }

      const result = await narrateRanking(req.db, {
        tutorId: hit.tutor.id,
        topicId: String(req.params.topicId),
        breakdown: hit.breakdown,
        lang,
      });

      res.json({ ...result, score: hit.score, breakdown: hit.breakdown });
    } catch (error) {
      next(error);
    }
  });

  /* --- The budget, visible (§7.4) ---------------------------------------- */

  router.get('/budget', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      res.json(await readBudget(req.db));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
