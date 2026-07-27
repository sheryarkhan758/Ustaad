/**
 * The analysis queue — FR-9.3.
 *
 * > On submission the review is queued for AI structured analysis
 * > asynchronously, **without blocking the interface**.
 *
 * An in-process queue, deliberately. §4.2 rules out message-broker
 * infrastructure, and the deployment target is a free-tier serverless host, so
 * a real queue is neither available nor affordable. What this gives is the
 * property FR-9.3 actually asks for: the POST returns as soon as the review is
 * stored, and the model call happens after the response has gone.
 *
 * ── What it does not give, stated plainly ──────────────────────────────────
 * It is **not durable**. A process that dies with work queued loses the
 * *analysis*, never the review — the review row is committed before anything is
 * enqueued, and it sits at `analysisStatus: 'pending'`. `drainPendingReviews`
 * exists to pick those up on the next start or from a scheduled run, which is
 * the recovery path a broker would otherwise provide.
 */

import { eq } from 'drizzle-orm';

import { reviews } from '../db/schema/feedback';
import type { Executor } from '../repositories/_base';
import { analyseReview, type AnalysisOutcome } from './review-analysis';

/** One at a time: the free inference tier is rate-limited, not wide. */
const CONCURRENCY = 1;

interface QueuedJob {
  reviewId: string;
  db: Executor;
}

const queue: QueuedJob[] = [];
let running = 0;
let idleWaiters: (() => void)[] = [];

/** Set by tests, so a failure surfaces instead of vanishing into a void. */
let onError: ((reviewId: string, error: unknown) => void) | null = null;

export function setQueueErrorHandler(
  handler: ((reviewId: string, error: unknown) => void) | null,
): void {
  onError = handler;
}

function settleIfIdle(): void {
  if (running === 0 && queue.length === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running += 1;

    void analyseReview(job.db, job.reviewId)
      .catch((error: unknown) => {
        // The review is already stored and sits at `pending`, so a crash here
        // costs an analysis and nothing else. `drainPendingReviews` retries it.
        if (onError) onError(job.reviewId, error);
        else {
          console.error(
            `[review-analysis] ${job.reviewId} failed: ` +
              (error instanceof Error ? error.message : 'unknown'),
          );
        }
      })
      .finally(() => {
        running -= 1;
        pump();
        settleIfIdle();
      });
  }
  settleIfIdle();
}

/**
 * Enqueue and return. **Never awaited by a request handler.**
 *
 * Scheduled with `setImmediate` so the work starts after the current response
 * has been written, not during it.
 */
export function enqueueReviewAnalysis(db: Executor, reviewId: string): void {
  queue.push({ db, reviewId });
  setImmediate(pump);
}

/** Resolves once the queue is empty and nothing is in flight. For tests. */
export function whenQueueIdle(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/**
 * Analyse everything still pending.
 *
 * The recovery path for work lost to a restart, and the entry point for a
 * scheduled sweep. Idempotent — `analyseReview` skips a review that already has
 * an analysis.
 */
export async function drainPendingReviews(db: Executor): Promise<AnalysisOutcome[]> {
  const pending = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.analysisStatus, 'pending'));

  const outcomes: AnalysisOutcome[] = [];
  for (const row of pending) {
    outcomes.push(await analyseReview(db, row.id));
  }
  return outcomes;
}
