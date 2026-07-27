/**
 * The demonstration surface — §6.15, FR-15.1 to FR-15.7.
 *
 * FR-15.1: *"Landing page 'See it work' panel offering five one-click
 * scenarios, **none requiring login**."* So every route here is anonymous.
 * There is no `requireAuth`, and that is the requirement rather than an
 * oversight — somebody assessing this project should not have to create an
 * account to see whether it works.
 *
 * ── Zero live model calls, structurally ────────────────────────────────────
 * FR-15.7, and §15's risk table: a free-tier rate limit reached during
 * assessment must not be able to take the demonstration down. This module and
 * the service beneath it therefore **import nothing from `server/ai/`**. They
 * read stored rows and return them. There is no code path from here to a
 * network socket, so the demonstration cannot fail because a provider did — it
 * works with every AI provider credential absent from `.env` entirely, which is
 * how `server/demo.flow.test.ts` exercises it.
 *
 * That is a stronger guarantee than `DEMO_REPLAY=true`. The flag makes a live
 * call *fail closed* inside `callModel`; this path never reaches `callModel`.
 *
 * ── Read-only, and stateless between turns ─────────────────────────────────
 * Nothing here writes. The turn number is a **path parameter** rather than
 * stored progress: two people demonstrating at the same time would otherwise
 * share one cursor and step on each other, and an anonymous endpoint that
 * writes is an anonymous endpoint that can be made to write a great deal.
 */

import { Router, type Response } from 'express';

import { listDemoAgentSessions } from '../repositories/demo';
import { buildScenarioList, findScenarioByKey } from '../services/demo';

/** Stated in the response, not only in the documentation. */
const REPLAY_NOTE = {
  liveModelCalls: 0 as const,
  note: 'Every scenario replays a stored session. No provider is contacted on this path and no API key is required.',
};

function notFound(res: Response, message: string): void {
  res.status(404).json({ error: { code: 'not_found', message } });
}

export function createDemoRouter(): Router {
  const router = Router();

  /**
   * FR-15.1 — the "See it work" panel: five scenarios, one click each.
   *
   * Each entry names the requirement it demonstrates, so the panel doubles as
   * a map from the specification to something you can press.
   */
  router.get('/scenarios', async (req, res, next) => {
    try {
      const items = buildScenarioList(await listDemoAgentSessions(req.db)).map(
        ({ key, title, summary, requirement, type, totalTurns }) => ({
          key,
          title,
          summary,
          requirement,
          type,
          totalTurns,
          liveModelCalls: 0,
        }),
      );

      res.json({ items, count: items.length, replay: REPLAY_NOTE });
    } catch (error) {
      next(error);
    }
  });

  /** One scenario in full: transcript, provenance and exhibit. */
  router.get('/scenarios/:key', async (req, res, next) => {
    try {
      const scenario = findScenarioByKey(
        await listDemoAgentSessions(req.db),
        String(req.params.key),
      );
      if (!scenario) return notFound(res, 'No such demonstration scenario.');
      res.json({ scenario, replay: REPLAY_NOTE });
    } catch (error) {
      next(error);
    }
  });

  /**
   * One turn — the turn-by-turn replay the panel steps through.
   *
   * `index` is 0-based. Idempotent: asking for turn 2 twice returns turn 2
   * twice, and never advances anything.
   */
  router.get('/scenarios/:key/turns/:index', async (req, res, next) => {
    try {
      const scenario = findScenarioByKey(
        await listDemoAgentSessions(req.db),
        String(req.params.key),
      );
      if (!scenario) return notFound(res, 'No such demonstration scenario.');

      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0) {
        res.status(400).json({
          error: {
            code: 'validation_failed',
            message: 'Turn index must be a whole number, zero or greater.',
          },
        });
        return;
      }

      const turn = scenario.turns[index];
      if (!turn) return notFound(res, 'No such turn in this scenario.');

      res.json({
        scenarioKey: scenario.key,
        index,
        turn,
        hasNext: index + 1 < scenario.turns.length,
        totalTurns: scenario.turns.length,
        liveModelCalls: 0,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
