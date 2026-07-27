/**
 * Public search — §6.7, §6.16, NFR-1.
 *
 * Unauthenticated: browsing and searching require no login (FR-1.6). Booking
 * does, and that gate is on the booking route.
 *
 * The handler is thin on purpose. The hard exclusion, the ranking and the
 * paging all live in `server/repositories/search.ts` and `shared/ranking.ts`,
 * so there is one place to read to know what a search can return.
 */

import { Router } from 'express';

import { searchQuerySchema } from '../../shared/search';
import { searchTutors } from '../repositories/search';

export function createSearchRouter(): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'validation_failed',
            message: 'Please check your search filters.',
            issues: parsed.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
        });
        return;
      }

      const response = await searchTutors(req.db, parsed.data);

      res.json({
        results: response.results.map((r) => ({
          tutorId: r.tutor.id,
          slug: r.tutor.slug,
          gender: r.tutor.gender,
          cityId: r.tutor.cityId,
          experienceYears: r.tutor.experienceYears,
          volunteer: r.tutor.volunteer,
          /*
           * What a result card shows beyond the ranking (§6.7). Loaded over
           * the paged results only, from columns a job materialised — the
           * client arranges these, it computes none of them (§2.8).
           */
          displayName: r.detail?.displayName ?? '',
          bio: r.detail?.bio ?? null,
          willingAreaIds: r.detail?.willingAreaIds ?? [],
          verifiedArtefacts: r.detail?.verifiedArtefacts ?? [],
          competency: r.detail?.competency ?? [],
          reliability: r.detail?.reliability ?? null,
          engagementTypes: r.detail?.engagementTypes ?? [],
          score: r.score,
          normalisedHourly: r.normalisedHourly,
          benchmarkMedian: r.benchmarkMedian,
          travelMinutes: r.travelMinutes,
          // Handed to the narration component (§6.22) unchanged. It explains
          // this and may introduce no figure absent from it (FR-22.4).
          breakdown: r.breakdown,
        })),
        total: response.total,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        // Restated so a client can see the exclusion was applied server-side
        // and is not something it needs to apply itself (FR-16.3).
        appliedGenderPreference: response.appliedGenderPreference,
        tookMs: response.tookMs,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
