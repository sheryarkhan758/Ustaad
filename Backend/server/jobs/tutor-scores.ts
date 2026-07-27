/**
 * `tutor_scores` and `tutor_search_signals` materialisation — §6.22, FR-7.5,
 * FR-9.6, FR-9.9, NFR-15.
 *
 * Writes the query-independent half of ranking, so that search reads columns
 * instead of counting reviews. Two things this job is careful about:
 *
 *  · **Per-topic scores are aggregated separately from the overall composite**
 *    (FR-9.9). A tutor strong in Organic Chemistry is not thereby strong in
 *    Thermodynamics, and flattening the two would let one good topic carry a
 *    profile.
 *  · **Generic reviews are down-weighted, never hidden and never deleted**
 *    (FR-9.6). The weight comes from `review_analyses.credibility_weight`,
 *    which the AI classifier sets; the arithmetic applying it is here, in code.
 *
 * `scoreHash` keys the narration cache (§6.22): the explanation is regenerated
 * only when the underlying signals change, which is what keeps §7.4's token
 * budget reachable.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { nowIso } from '../../shared/db-values';
import { bookings } from '../db/schema/booking';
import { tutorScores, tutorSearchSignals } from '../db/schema/derived';
import { reviewAnalyses, reviews } from '../db/schema/feedback';
import { tutorProfiles, tutorSubjectClaims } from '../db/schema/tutor';
import { verificationRecords } from '../db/schema/verification';
import type { Executor } from '../repositories/_base';

/** Activity older than this contributes nothing to the recency term. */
export const RECENCY_HALF_LIFE_DAYS = 90;
export const RECENCY_FLOOR_DAYS = 365;

/**
 * Linear decay to zero at one year.
 *
 * Linear rather than exponential on purpose: a tutor should be able to
 * understand why their recency figure is what it is, and "you were last active
 * four months ago, so this is about two thirds" is explainable in a way that a
 * half-life is not.
 */
export function recencyScore(lastActiveAt: string | null, now: Date): number {
  if (!lastActiveAt) return 0;
  const days = (now.getTime() - new Date(lastActiveAt).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return 1;
  if (days >= RECENCY_FLOOR_DAYS) return 0;
  return Math.round((1 - days / RECENCY_FLOOR_DAYS) * 10_000) / 10_000;
}

/**
 * Review score from credibility-weighted ratings.
 *
 * A weighted mean of 1–5 ratings mapped onto 0–1. With no reviews the result is
 * **0.5, not 0** — the same cold-start reasoning as reliability: the platform
 * does not know yet, and ranking an unreviewed tutor below a badly-reviewed one
 * would make it impossible to get a first booking.
 */
export function weightedReviewScore(
  entries: ReadonlyArray<{ rating: number; weight: number }>,
): { score: number; weightedCount: number } {
  if (entries.length === 0) return { score: 0.5, weightedCount: 0 };

  let weightSum = 0;
  let weighted = 0;
  for (const entry of entries) {
    const weight = Math.max(0, entry.weight);
    weightSum += weight;
    weighted += ((Math.min(5, Math.max(1, entry.rating)) - 1) / 4) * weight;
  }

  if (weightSum === 0) return { score: 0.5, weightedCount: 0 };
  return {
    score: Math.round((weighted / weightSum) * 10_000) / 10_000,
    weightedCount: Math.round(weightSum * 100) / 100,
  };
}

/** Stable across runs: same inputs, same hash, so the narration cache holds. */
export function hashScore(parts: Record<string, number | string | null>): string {
  const canonical = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${String(parts[k])}`)
    .join('&');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export interface ScoresJobResult {
  tutors: number;
  topicRows: number;
  tookMs: number;
}

export async function recomputeTutorScores(
  db: Executor,
  now: Date = new Date(),
): Promise<ScoresJobResult> {
  const startedAt = performance.now();
  const today = now.toISOString().slice(0, 10);

  const tutors = await db.select().from(tutorProfiles);
  const claims = await db.select().from(tutorSubjectClaims);
  const allReviews = await db.select().from(reviews);
  const analyses = await db.select().from(reviewAnalyses);
  const records = await db.select().from(verificationRecords);
  const allBookings = await db
    .select({
      tutorId: bookings.tutorId,
      statusChangedAt: bookings.statusChangedAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings);

  const weightByReviewId = new Map(analyses.map((a) => [a.reviewId, a.credibilityWeight]));

  const reviewsByTutor = new Map<string, { rating: number; weight: number }[]>();
  for (const review of allReviews) {
    const list = reviewsByTutor.get(review.tutorId) ?? [];
    // Absent analysis means the classifier has not run yet; weight 1 rather
    // than 0, so an unanalysed review is not silently discarded.
    list.push({ rating: review.rating, weight: weightByReviewId.get(review.id) ?? 1 });
    reviewsByTutor.set(review.tutorId, list);
  }

  const claimsByTutor = new Map<string, typeof claims>();
  for (const claim of claims) {
    const list = claimsByTutor.get(claim.tutorId) ?? [];
    list.push(claim);
    claimsByTutor.set(claim.tutorId, list);
  }

  const artefactCountByTutor = new Map<string, number>();
  for (const record of records) {
    if (record.track !== 'identity') continue;
    if (record.decision !== 'approved' && record.decision !== 'overridden') continue;
    const artefacts = JSON.parse(record.artefactsCheckedJson) as string[];
    // Latest decision wins; records are ordered by insertion within a tutor.
    artefactCountByTutor.set(record.tutorId, artefacts.length);
  }

  const lastActiveByTutor = new Map<string, string>();
  for (const booking of allBookings) {
    const stamp = booking.statusChangedAt ?? booking.createdAt;
    const current = lastActiveByTutor.get(booking.tutorId);
    if (!current || stamp > current) lastActiveByTutor.set(booking.tutorId, stamp);
  }

  let topicRows = 0;

  for (const tutor of tutors) {
    const { score: reviewScore, weightedCount } = weightedReviewScore(
      reviewsByTutor.get(tutor.id) ?? [],
    );
    const artefacts = artefactCountByTutor.get(tutor.id) ?? 0;
    const tutorClaims = claimsByTutor.get(tutor.id) ?? [];

    /* --- per topic (FR-9.9) --------------------------------------------- */

    await db.delete(tutorScores).where(eq(tutorScores.tutorId, tutor.id));

    let bestTopicScore = 0;
    let verifiedTopicCount = 0;

    /**
     * Best score per topic.
     *
     * A tutor may legitimately claim the same topic under two different
     * (subject, level, board) triples — Quadratic Equations appears in both a
     * Matric and an Intermediate claim — and `tutor_scores` is keyed by
     * (tutor, topic). Writing per claim would collide on the primary key, so
     * the strongest claim for a topic wins and the rest are folded in.
     */
    const perTopic = new Map<
      string,
      { composite: number; competency: number; verified: boolean; expiresOn: string | null }
    >();

    for (const claim of tutorClaims) {
      const live =
        claim.claimStatus === 'verified' &&
        (claim.expiresOn === null || claim.expiresOn > today);
      if (live) verifiedTopicCount += 1;

      // A passed assessment is worth more than an assertion, and the review
      // signal is shared across a tutor's topics because reviews are not
      // per-topic until §6.9's classifier attributes them.
      const competency = live ? (claim.verifiedScore ?? 80) / 100 : 0.25;
      const composite = Math.round((competency * 0.6 + reviewScore * 0.4) * 10_000) / 10_000;
      if (composite > bestTopicScore) bestTopicScore = composite;

      for (const topicId of JSON.parse(claim.topicIdsJson) as string[]) {
        const current = perTopic.get(topicId);
        if (!current || composite > current.composite) {
          perTopic.set(topicId, {
            composite,
            competency,
            verified: live,
            expiresOn: claim.expiresOn,
          });
        }
      }
    }

    // Sorted, so two runs over the same data write rows in the same order.
    for (const topicId of [...perTopic.keys()].sort()) {
      const topic = perTopic.get(topicId)!;
      await db.insert(tutorScores).values({
        tutorId: tutor.id,
        topicId,
        compositeScore: topic.composite,
        dimensionScoresJson: JSON.stringify({
          competency: Math.round(topic.competency * 10_000) / 10_000,
          reviews: reviewScore,
        }),
        reviewCount: (reviewsByTutor.get(tutor.id) ?? []).length,
        weightedReviewCount: weightedCount,
        competencyVerified: topic.verified ? 1 : 0,
        expiresOn: topic.expiresOn,
        scoreHash: hashScore({
          tutorId: tutor.id,
          topicId,
          composite: topic.composite,
          artefacts,
        }),
        computedAt: nowIso(),
      });
      topicRows += 1;
    }

    /* --- the per-tutor roll-up ------------------------------------------- */

    const overall =
      tutorClaims.length > 0
        ? Math.round(((bestTopicScore * 0.5 + reviewScore * 0.5) as number) * 10_000) / 10_000
        : reviewScore;

    const lastActiveAt = lastActiveByTutor.get(tutor.id) ?? tutor.createdAt;

    const signals = {
      overallScore: overall,
      bestTopicScore,
      artefactsCheckedCount: artefacts,
      verifiedTopicCount,
      reviewCount: (reviewsByTutor.get(tutor.id) ?? []).length,
      weightedReviewCount: weightedCount,
      lastActiveAt,
      recencyScore: recencyScore(lastActiveAt, now),
      minNormalisedHourly: null,
      computedAt: nowIso(),
    };

    const existing = await db
      .select({ tutorId: tutorSearchSignals.tutorId })
      .from(tutorSearchSignals)
      .where(eq(tutorSearchSignals.tutorId, tutor.id))
      .limit(1);

    if (existing[0]) {
      await db
        .update(tutorSearchSignals)
        .set(signals)
        .where(eq(tutorSearchSignals.tutorId, tutor.id));
    } else {
      await db.insert(tutorSearchSignals).values({ tutorId: tutor.id, ...signals });
    }
  }

  return {
    tutors: tutors.length,
    topicRows,
    tookMs: Math.round(performance.now() - startedAt),
  };
}
