/**
 * Administrator verification endpoints — §6.6, §6.28.
 *
 * Every route is `requireRole('admin')`. Every decision writes an
 * `admin_actions` row. **Nothing here updates or deletes one** — the services
 * these handlers call expose no such operation, and `server/services/audit.ts`
 * has no update or delete function to expose (NFR-19, SEC-13).
 */

import { Router, type Response } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  approveIdentitySchema,
  decideAppealSchema,
  rejectIdentitySchema,
  requestMoreInfoSchema,
  verificationQueueQuerySchema,
  viewDocumentSchema,
} from '../../shared/verification';
import { flags } from '../db/schema/admin';
import { tutorProfiles } from '../db/schema/tutor';
import { verificationRecords } from '../db/schema/verification';
import { requireAuth, requireRole } from '../middleware/auth';
import { listTutorDocuments } from '../repositories/tutors';
import { readAuditTrailFor } from '../services/audit';
import { decideAppeal, listOpenAppeals } from '../services/verification-appeals';
import {
  approveIdentity,
  buildPublicVerification,
  rejectIdentity,
  requestMoreInformation,
  viewDocument,
} from '../services/verification';

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

export function createAdminVerificationRouter(): Router {
  const router = Router();
  const adminOnly = [requireAuth, requireRole('admin')] as const;

  /* --- The queue — FR-6.4, FR-14.3 --------------------------------------- */

  /**
   * `GET /api/admin/verifications`
   *
   * Default sort is **oldest first**, with the profile id as a stable
   * tiebreaker. Newest-first starves the tail of the queue, and the tail here
   * is people waiting to be allowed to earn. The tiebreaker matters too: two
   * profiles submitted in the same millisecond must not swap places between
   * page loads, or an administrator reviews one twice and another never.
   */
  router.get('/', ...adminOnly, async (req, res, next) => {
    try {
      const query = parse<ReturnType<typeof verificationQueueQuerySchema.parse>>(
        verificationQueueQuerySchema,
        req.query,
        res,
      );
      if (!query) return;

      const conditions = [];
      if (query.status) conditions.push(eq(tutorProfiles.profileStatus, query.status));
      else {
        conditions.push(
          inArray(tutorProfiles.profileStatus, [
            'pending_verification',
            'documents_submitted',
            'under_review',
          ]),
        );
      }
      if (query.cityId) conditions.push(eq(tutorProfiles.cityId, query.cityId));

      let rows = await req.db
        .select()
        .from(tutorProfiles)
        .where(and(...conditions))
        .orderBy(
          query.sort === 'newest_first'
            ? desc(tutorProfiles.createdAt)
            : query.sort === 'city'
              ? asc(tutorProfiles.cityId)
              : asc(tutorProfiles.createdAt),
          // Stable tiebreaker.
          asc(tutorProfiles.id),
        );

      // Duplicate-CNIC flags, so the queue can be filtered to the ones that
      // most need a person (FR-28.7).
      const openFlags = await req.db
        .select()
        .from(flags)
        .where(and(eq(flags.reason, 'duplicate_cnic'), eq(flags.status, 'open')));
      const flagged = new Set(openFlags.map((f) => f.targetId));

      if (query.duplicateCnicOnly) rows = rows.filter((r) => flagged.has(r.id));

      const page = rows.slice(query.offset, query.offset + query.limit);

      res.json({
        total: rows.length,
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        items: page.map((r) => ({
          tutorId: r.id,
          slug: r.slug,
          cityId: r.cityId,
          gender: r.gender,
          profileStatus: r.profileStatus,
          submittedAt: r.createdAt,
          duplicateCnicFlagged: flagged.has(r.id),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- One tutor's dossier ------------------------------------------------ */

  router.get('/:tutorId', ...adminOnly, async (req, res, next) => {
    try {
      const tutorId = String(req.params.tutorId);

      const documents = await listTutorDocuments(req.db, tutorId);
      const history = await req.db
        .select()
        .from(verificationRecords)
        .where(eq(verificationRecords.tutorId, tutorId))
        .orderBy(asc(verificationRecords.decidedAt));

      res.json({
        // Metadata only. Opening a document is a separate, logged act.
        documents: documents.map((d) => ({
          id: d.id,
          docType: d.docType,
          uploadedAt: d.uploadedAt,
        })),
        history: history.map((r) => ({
          id: r.id,
          track: r.track,
          decision: r.decision,
          artefactsChecked: JSON.parse(r.artefactsCheckedJson) as string[],
          decidedBy: r.decidedBy,
          decidedAt: r.decidedAt,
          reason: r.reason,
          supersedesId: r.supersedesId,
        })),
        auditTrail: await readAuditTrailFor(req.db, 'tutor_profile', tutorId),
      });
    } catch (error) {
      next(error);
    }
  });

  /* --- Document view — logged every time (SEC-7, NFR-9) ------------------ */

  router.post('/:tutorId/documents/:documentId/view', ...adminOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof viewDocumentSchema.parse>>(
        viewDocumentSchema,
        req.body ?? {},
        res,
      );
      if (!input) return;

      const result = await viewDocument(req.db, {
        adminUserId: req.auth!.userId,
        tutorId: String(req.params.tutorId),
        documentId: String(req.params.documentId),
        purpose: input.purpose,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /* --- Decisions — each requires a written reason ------------------------ */

  router.post('/:tutorId/approve', ...adminOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof approveIdentitySchema.parse>>(
        approveIdentitySchema,
        req.body,
        res,
      );
      if (!input) return;

      const result = await approveIdentity(req.db, {
        tutorId: String(req.params.tutorId),
        adminUserId: req.auth!.userId,
        artefactsChecked: input.artefactsChecked,
        reason: input.reason,
      });

      res.json({
        ...result,
        verification: await buildPublicVerification(req.db, String(req.params.tutorId)),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:tutorId/reject', ...adminOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof rejectIdentitySchema.parse>>(
        rejectIdentitySchema,
        req.body,
        res,
      );
      if (!input) return;

      res.json(
        await rejectIdentity(req.db, {
          tutorId: String(req.params.tutorId),
          adminUserId: req.auth!.userId,
          artefactsChecked: input.artefactsChecked,
          reason: input.reason,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/:tutorId/request-info', ...adminOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof requestMoreInfoSchema.parse>>(
        requestMoreInfoSchema,
        req.body,
        res,
      );
      if (!input) return;

      res.json(
        await requestMoreInformation(req.db, {
          tutorId: String(req.params.tutorId),
          adminUserId: req.auth!.userId,
          missingArtefacts: input.missingArtefacts,
          reason: input.reason,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  /* --- Appeals — §6.28, decision 12 -------------------------------------- */

  router.get('/appeals/open', ...adminOnly, async (req, res, next) => {
    try {
      const appeals = await listOpenAppeals(req.db);
      res.json({
        appeals: appeals.map((a) => ({
          id: a.id,
          tutorId: a.tutorId,
          track: a.track,
          againstRecordId: a.againstRecordId,
          tutorReason: a.tutorReason,
          filedAt: a.createdAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/appeals/:appealId/decide', ...adminOnly, async (req, res, next) => {
    try {
      const input = parse<ReturnType<typeof decideAppealSchema.parse>>(
        decideAppealSchema,
        req.body,
        res,
      );
      if (!input) return;

      res.json(
        await decideAppeal(req.db, {
          appealId: String(req.params.appealId),
          adminUserId: req.auth!.userId,
          outcome: input.outcome,
          reason: input.reason,
          artefactsChecked: input.artefactsChecked,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
