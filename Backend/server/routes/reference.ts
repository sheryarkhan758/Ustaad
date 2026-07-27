/**
 * Reference data — §6.2, §6.3.
 *
 * The taxonomies the two cascading pickers are built from: provinces, cities,
 * areas and their adjacency; subjects, levels, boards, topics and the
 * prerequisite graph.
 *
 * ── Anonymous, and cached hard ─────────────────────────────────────────────
 * Browsing and search require no account (FR-1.6), so the pickers a search page
 * is made of cannot require one either.
 *
 * This is the only data in the system that is genuinely static: seeded from
 * committed files, containing no user information, changing only when somebody
 * edits a seed and redeploys (§12). So it carries a long `Cache-Control` and
 * the client fetches each list once per session. A picker that refetched the
 * area list on every keystroke would spend a metered connection on data that
 * cannot have changed.
 *
 * ── No map, no pin, no coordinates ─────────────────────────────────────────
 * Area is the finest granularity in this product (§4.2). There is no latitude,
 * no longitude and no radius anywhere in these responses — "neighbouring areas"
 * is a hand-curated adjacency list, not a distance calculation, and the
 * interface must not imply otherwise.
 */

import { Router, type Response } from 'express';
import { z } from 'zod';

import {
  listAdjacentAreas,
  listAreas,
  listBoards,
  listCities,
  listLevels,
  listPrerequisiteEdges,
  listProvinces,
  listServiceTypes,
  listSubjects,
  listTopics,
  listTopicsByIds,
} from '../repositories/reference';

/**
 * One hour in the browser, a day on a shared cache, and served stale for a week
 * while revalidating. Reference data changes on deployment, not on a schedule.
 */
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

function cached(res: Response, payload: unknown): void {
  res.set('Cache-Control', CACHE).json(payload);
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'validation_failed', message } });
}

const topicsQuerySchema = z.object({
  subjectId: z.string().min(1),
  levelId: z.string().min(1),
  /**
   * Required, not optional. Board is a first-class part of the curriculum
   * triple (decision 5) — topics for a subject and level alone would be wrong
   * for whichever board the family actually sits.
   */
  boardId: z.string().min(1),
});

const idListSchema = z.object({
  ids: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1).max(60)),
});

export function createReferenceRouter(): Router {
  const router = Router();

  /* --- Location — §6.2 ------------------------------------------------ */

  router.get('/provinces', async (req, res, next) => {
    try {
      cached(res, { items: await listProvinces(req.db) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cities', async (req, res, next) => {
    try {
      const provinceId = req.query.provinceId ? String(req.query.provinceId) : undefined;
      cached(res, { items: await listCities(req.db, provinceId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/areas', async (req, res, next) => {
    try {
      const cityId = req.query.cityId ? String(req.query.cityId) : undefined;
      cached(res, { items: await listAreas(req.db, cityId) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * FR-2.7 — areas a family would consider near enough.
   *
   * A curated adjacency list, not a radius. `GET /areas/adjacent?ids=a,b`.
   */
  router.get('/areas/adjacent', async (req, res, next) => {
    try {
      const parsed = idListSchema.safeParse({ ids: String(req.query.ids ?? '') });
      if (!parsed.success) return invalid(res, 'Pass one or more area ids as ?ids=a,b,c');

      cached(res, { items: await listAdjacentAreas(req.db, parsed.data.ids) });
    } catch (error) {
      next(error);
    }
  });

  /* --- Curriculum — §6.3 ---------------------------------------------- */

  router.get('/subjects', async (req, res, next) => {
    try {
      cached(res, { items: await listSubjects(req.db) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/levels', async (req, res, next) => {
    try {
      cached(res, { items: await listLevels(req.db) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/boards', async (req, res, next) => {
    try {
      cached(res, { items: await listBoards(req.db) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/topics', async (req, res, next) => {
    try {
      const parsed = topicsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return invalid(res, 'subjectId, levelId and boardId are all required — board is part of the curriculum, not a detail of it.');
      }

      cached(res, { items: await listTopics(req.db, parsed.data) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The prerequisite graph — §2.4, FR-3.4.
   *
   * Returns the edges reachable from the given topics together with every topic
   * they name, so a client can draw the chain without a second round trip.
   * Walked breadth-first here rather than recursively in SQL, because the graph
   * is small, board-scoped and acyclic, and a recursive CTE would be the one
   * query in this codebase that behaves differently on the two dialects (§2.1).
   */
  router.get('/topics/prerequisites', async (req, res, next) => {
    try {
      const parsed = idListSchema.safeParse({ ids: String(req.query.ids ?? '') });
      if (!parsed.success) return invalid(res, 'Pass one or more topic ids as ?ids=a,b,c');

      const seen = new Set(parsed.data.ids);
      const edges: { topicId: string; prerequisiteTopicId: string }[] = [];
      let frontier = parsed.data.ids;

      // Bounded rather than `while (frontier.length)`: the seed validates the
      // graph is acyclic, but a documentation endpoint must not be the thing
      // that hangs if that ever stops being true.
      for (let depth = 0; depth < 12 && frontier.length > 0; depth += 1) {
        const found = await listPrerequisiteEdges(req.db, frontier);
        edges.push(...found);

        const next = found
          .map((edge) => edge.prerequisiteTopicId)
          .filter((id) => !seen.has(id));
        next.forEach((id) => seen.add(id));
        frontier = [...new Set(next)];
      }

      cached(res, {
        edges,
        topics: await listTopicsByIds(req.db, [...seen]),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/service-types', async (req, res, next) => {
    try {
      cached(res, { items: await listServiceTypes(req.db) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
