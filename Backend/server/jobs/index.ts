/**
 * Materialisation jobs — §9.4, NFR-15, CLAUDE.md §2.8.
 *
 * **These are the only writers of `tutor_scores`, `tutor_search_signals`,
 * `tutor_reliability` and `rate_benchmarks`.** A request handler reads those
 * tables and never writes them, which is what lets a search do no arithmetic
 * beyond a weighted sum over values it was handed.
 *
 *   npx tsx server/jobs/index.ts
 *
 * Order matters: benchmarks read rates, and scores read verification records
 * and reviews, so a run that produced scores before verification decisions were
 * in place would publish stale rankings. They are cheap enough at this scale to
 * run as one sequence.
 */

import 'dotenv/config';

import { recomputeRateBenchmarks } from './rate-benchmarks';
import { recomputeTutorReliability } from './tutor-reliability';
import { recomputeTutorScores } from './tutor-scores';
import type { Executor } from '../repositories/_base';

export { recomputeRateBenchmarks, recomputeTutorReliability, recomputeTutorScores };

export interface AllJobsResult {
  scores: Awaited<ReturnType<typeof recomputeTutorScores>>;
  reliability: Awaited<ReturnType<typeof recomputeTutorReliability>>;
  benchmarks: Awaited<ReturnType<typeof recomputeRateBenchmarks>>;
  totalMs: number;
}

export async function runAllMaterialisationJobs(
  db: Executor,
  now: Date = new Date(),
): Promise<AllJobsResult> {
  const startedAt = performance.now();

  const scores = await recomputeTutorScores(db, now);
  const reliability = await recomputeTutorReliability(db);
  const benchmarks = await recomputeRateBenchmarks(db);

  return {
    scores,
    reliability,
    benchmarks,
    totalMs: Math.round(performance.now() - startedAt),
  };
}

async function main(): Promise<void> {
  const { db } = await import('../db/index');
  const result = await runAllMaterialisationJobs(db);

  console.log('▸ materialisation jobs');
  console.log(`  tutor_scores          ${result.scores.tutors} tutors, ${result.scores.topicRows} topic rows  (${result.scores.tookMs} ms)`);
  console.log(`  tutor_reliability     ${result.reliability.written} tutors  (${result.reliability.tookMs} ms)`);
  console.log(`  rate_benchmarks       ${result.benchmarks.published} published, ${result.benchmarks.suppressed} suppressed below a cohort of 4  (${result.benchmarks.tookMs} ms)`);
  console.log(`✓ done in ${result.totalMs} ms`);
}

if (process.argv[1]?.includes('jobs/index')) {
  main().catch((error: unknown) => {
    console.error('✗ job run failed:', error);
    process.exitCode = 1;
  });
}
