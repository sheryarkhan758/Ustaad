/**
 * The one place a model is actually called — §7.2, §7.4, NFR-11.
 *
 * Every component goes through `callModel`, which does five things in order and
 * in this order for a reason:
 *
 *  1. **Replay** — if this is a seeded demonstration session, return the stored
 *     response and make no network call at all (§6.15, §7.4).
 *  2. **Demo mode** — with `DEMO_REPLAY=true`, a call that found no stored
 *     response fails here rather than going to the network, so "the demo makes
 *     no live call" is enforced rather than hoped for.
 *  3. **Budget** — if today's allowance is spent, throw `AiBudgetExceededError`
 *     so the caller degrades to the manual path rather than erroring out.
 *  4. **Call**, through the failover chain in `provider.ts`.
 *  5. **Parse** against a Zod schema, retrying once. A malformed response is
 *     never stored and never guessed at.
 *  6. **Log** the call — tokens, latency, provider, whether it failed over.
 *
 * Nothing else in the codebase touches a provider directly, which is what makes
 * the budget guard and the usage log complete rather than best-effort.
 */

import type { z } from 'zod';

import type { Executor } from '../repositories/_base';
import {
  AiBudgetExceededError,
  MAX_OUTPUT_TOKENS,
  isDemoReplayEnabled,
  approximateTokens,
  assertBudget,
  estimateCostMicros,
  logAiCall,
  type AiComponent,
} from './budget';
import { getAiProvider } from './provider';

/**
 * Raised when `DEMO_REPLAY=true` and no stored response covers this call.
 *
 * The demonstration path must be provable, not merely likely: with the flag on,
 * **nothing** in this process can reach a provider, so "the demo makes no live
 * call" is a property of the build rather than of how carefully the seed data
 * was prepared. Callers treat it like any other AI failure and take their
 * non-AI path (NFR-11).
 */
export class DemoReplayMissError extends Error {
  readonly status = 503;
  readonly code = 'demo_replay_miss';

  constructor(component: string) {
    super(`DEMO_REPLAY is on and no stored response exists for ${component}`);
    this.name = 'DemoReplayMissError';
  }
}

export class AiParseError extends Error {
  readonly status = 502;
  readonly code = 'ai_unparseable';

  constructor(component: string) {
    super(`the ${component} model response could not be parsed after a retry`);
    this.name = 'AiParseError';
  }
}

export interface CallOptions<S extends z.ZodTypeAny> {
  component: AiComponent;
  prompt: string;
  schema: S;
  /** A stored response to replay verbatim, making no network call (§6.15). */
  replay?: string | null;
  maxOutputTokens?: number;
}

export interface CallResult<T> {
  value: T;
  model: string;
  provider: string;
  cacheHit: boolean;
  attempts: number;
}

/** Strip a fence, if the model wrapped valid JSON in an invalid envelope. */
function unwrap(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}

export async function callModel<S extends z.ZodTypeAny>(
  db: Executor,
  options: CallOptions<S>,
): Promise<CallResult<z.output<S>>> {
  const startedAt = performance.now();

  /* --- 1. Replay: zero live calls (§7.4, §6.15) -------------------------- */

  if (options.replay) {
    const parsed = options.schema.safeParse(JSON.parse(unwrap(options.replay)));
    if (parsed.success) {
      await logAiCall(db, {
        component: options.component,
        provider: 'replay',
        model: 'seeded-demo-session',
        cacheHit: true,
        latencyMs: Math.round(performance.now() - startedAt),
      });
      return {
        value: parsed.data,
        model: 'seeded-demo-session',
        provider: 'replay',
        cacheHit: true,
        attempts: 0,
      };
    }
    // A stored replay that no longer matches the schema means the contract
    // moved on. Fall through to a live call rather than serving something the
    // rest of the system cannot read.
  }

  /* --- 2. Demo mode: a live call is impossible, not just unlikely --------- */

  if (isDemoReplayEnabled()) throw new DemoReplayMissError(options.component);

  /* --- 3. Budget: degrade, never error out ------------------------------- */

  await assertBudget(db);

  /* --- 4–6. Call, parse with one retry, log ------------------------------ */

  const provider = getAiProvider();
  const maxOutputTokens = options.maxOutputTokens ?? MAX_OUTPUT_TOKENS[options.component];
  let lastProvider = provider.name;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw: { text: string; model: string; provider?: string; failedOver?: boolean };

    try {
      raw = await provider.complete({ prompt: options.prompt, maxOutputTokens });
    } catch (error) {
      if (error instanceof AiBudgetExceededError) throw error;
      continue;
    }

    lastProvider = raw.provider ?? provider.name;
    const parsed = options.schema.safeParse(
      (() => {
        try {
          return JSON.parse(unwrap(raw.text));
        } catch {
          return null;
        }
      })(),
    );

    await logAiCall(db, {
      component: options.component,
      provider: lastProvider,
      model: raw.model,
      promptTokens: approximateTokens(options.prompt),
      completionTokens: approximateTokens(raw.text),
      estimatedCostMicros: estimateCostMicros(
        lastProvider,
        approximateTokens(options.prompt),
        approximateTokens(raw.text),
      ),
      failedOver: raw.failedOver ?? false,
      latencyMs: Math.round(performance.now() - startedAt),
    });

    if (parsed.success) {
      return {
        value: parsed.data,
        model: raw.model,
        provider: lastProvider,
        cacheHit: false,
        attempts: attempt,
      };
    }
  }

  throw new AiParseError(options.component);
}
