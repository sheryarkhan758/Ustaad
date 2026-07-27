/**
 * Cost control — §7.4.
 *
 * > The platform is designed to operate within a permanent free inference tier.
 * > This is an architectural constraint, addressed architecturally.
 *
 * Three mechanisms live here:
 *
 *  1. **A per-call usage log**, so the spend is visible rather than assumed.
 *  2. **A global daily budget guard** that stops making live calls once the
 *     day's allowance is used.
 *  3. **A content-hash cache** shared by the three single-shot components.
 *
 * ── What the guard does when the budget is gone ────────────────────────────
 * It **degrades, it does not error**. NFR-11 requires every AI-dependent path
 * to have a working non-AI fallback, and FR-10.11 says a provider failure
 * presents manual search with an explanatory notice, *never an error state*. A
 * family who has typed out their child's difficulty and gets a stack trace has
 * been failed twice. So `assertBudget` throws a typed, catchable error and
 * every caller turns it into the manual path.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { newId, nowIso, toDbBool } from '../../shared/db-values';
import { aiCallLog } from '../db/schema/ai';
import type { Executor } from '../repositories/_base';

/** ISO `YYYY-MM-DD`, UTC. The budget window. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Live calls permitted per day.
 *
 * §7.4 estimates under eight hundred requests across the whole project. A
 * hundred a day is comfortably inside every free tier this project uses and
 * still far more than a demonstration needs — the guard exists to catch a
 * runaway loop, not to ration ordinary use.
 */
export const DEFAULT_DAILY_CALL_BUDGET = 100;

export function dailyCallBudget(): number {
  const configured = Number(process.env.AI_DAILY_CALL_BUDGET ?? DEFAULT_DAILY_CALL_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_CALL_BUDGET;
}

/** Per §7.4: a bounded worst case per session, enforced in code. */
export const MAX_OUTPUT_TOKENS = Object.freeze({
  diagnostic_intake: 1200,
  competency_verification: 1600,
  narration: 400,
  study_plan: 1800,
  review_intelligence: 2048,
});

export type AiComponent = keyof typeof MAX_OUTPUT_TOKENS;

/**
 * Thrown when the day's allowance is spent.
 *
 * Carries `degradeTo` so a caller does not have to decide what "no AI" means
 * for its surface — the answer is already in the type.
 */
export class AiBudgetExceededError extends Error {
  readonly status = 503;
  readonly code = 'ai_budget_exceeded';
  readonly degradeTo = 'manual' as const;

  constructor(used: number, limit: number) {
    super(
      `The AI allowance for today is used (${used} of ${limit} calls). ` +
        'Manual search is available and unaffected.',
    );
    this.name = 'AiBudgetExceededError';
  }
}

export interface BudgetState {
  day: string;
  liveCalls: number;
  cachedCalls: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

/** Only live calls count. A cache hit costs nothing and is not rationed. */
export async function readBudget(db: Executor, at: Date = new Date()): Promise<BudgetState> {
  const day = utcDay(at);
  const rows = await db.select().from(aiCallLog).where(eq(aiCallLog.day, day));

  const liveCalls = rows.filter((r) => r.cacheHit === 0).length;
  const limit = dailyCallBudget();

  return {
    day,
    liveCalls,
    cachedCalls: rows.length - liveCalls,
    limit,
    remaining: Math.max(0, limit - liveCalls),
    exhausted: liveCalls >= limit,
  };
}

/** @throws {AiBudgetExceededError} */
export async function assertBudget(db: Executor, at: Date = new Date()): Promise<void> {
  const budget = await readBudget(db, at);
  if (budget.exhausted) throw new AiBudgetExceededError(budget.liveCalls, budget.limit);
}

export interface UsageEntry {
  component: AiComponent | string;
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostMicros?: number;
  cacheHit?: boolean;
  failedOver?: boolean;
  latencyMs?: number;
}

/**
 * Record one call.
 *
 * Never records the prompt or the response: both quote user content
 * (CLAUDE.md §2.2). What is recorded is shape and cost.
 */
export async function logAiCall(
  db: Executor,
  entry: UsageEntry,
  at: Date = new Date(),
): Promise<void> {
  await db.insert(aiCallLog).values({
    id: newId(),
    day: utcDay(at),
    component: entry.component,
    provider: entry.provider,
    model: entry.model,
    promptTokens: entry.promptTokens ?? 0,
    completionTokens: entry.completionTokens ?? 0,
    estimatedCostMicros: entry.estimatedCostMicros ?? 0,
    cacheHit: toDbBool(entry.cacheHit ?? false),
    failedOver: toDbBool(entry.failedOver ?? false),
    latencyMs: entry.latencyMs ?? 0,
    createdAt: nowIso(),
  });
}

/* -------------------------------------------------------------------------
 * The content-hash cache
 * ---------------------------------------------------------------------- */

/**
 * A stable key for a single-shot component's input.
 *
 * Sorted keys, so two structurally identical inputs hash the same however the
 * object was built — otherwise the cache would miss on property order and the
 * "identical input costs zero tokens" claim would quietly be false.
 */
export function contentHash(component: string, input: unknown): string {
  const canonical = JSON.stringify(input, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return value;
  });
  return createHash('sha256').update(`${component}:${canonical}`).digest('hex');
}

/**
 * Whether this session is a stored demonstration replay (§7.4, §6.15).
 *
 * A replayed session makes **zero live calls**. The assessed path must not
 * depend on a free-tier provider being reachable on the day, and a demonstration
 * that burns quota every rehearsal is a demonstration that fails at the worst
 * moment.
 */
export function isDemoReplayEnabled(): boolean {
  return process.env.DEMO_REPLAY === 'true';
}

/** Rough cost estimate, in millionths of a dollar. Zero on a free tier. */
export function estimateCostMicros(
  provider: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // Both providers are used on their free tiers, so the true figure is zero.
  // The arithmetic is here so the log stays meaningful if that ever changes,
  // and so a reviewer can see what a paid tier would have cost.
  const perMillion: Record<string, { in: number; out: number }> = {
    gemini: { in: 0, out: 0 },
    groq: { in: 0, out: 0 },
    heuristic: { in: 0, out: 0 },
  };
  const rate = perMillion[provider] ?? { in: 0, out: 0 };
  return Math.round((promptTokens * rate.in + completionTokens * rate.out) / 1_000_000);
}

/** Cheap approximation. Good enough to spot a prompt that has grown. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
