/**
 * The review analysis worker — §6.9, FR-9.3 to FR-9.11.
 *
 * ── Never blocks a submission ──────────────────────────────────────────────
 * FR-9.3: the review is queued for analysis and the interface returns
 * immediately. A family posting a review waits on one insert, not on a model.
 *
 * ── Never loses a review ───────────────────────────────────────────────────
 * A malformed model response is retried **once**, and then the review is marked
 * `unanalysed` and left alone. The review itself is untouched throughout: it is
 * the family's words, and no failure of ours is a reason to drop them.
 *
 * ── Never pays twice for the same text ─────────────────────────────────────
 * FR-9.11: a SHA-256 hash of the review text keys the cache. Identical text
 * reuses the stored analysis at zero token cost — which matters because the
 * whole AI layer has to fit inside a permanent free tier (§7.4).
 */

import { createHash } from 'node:crypto';

import { and, eq, ne } from 'drizzle-orm';

import { newId, nowIso, toDbBool } from '../../shared/db-values';
import {
  computeCredibility,
  reviewAnalysisResponseSchema,
  type ReviewAnalysisResponse,
} from '../../shared/review-analysis';
import { bookings } from '../db/schema/booking';
import { reviewAnalyses, reviews } from '../db/schema/feedback';
import type { Executor } from '../repositories/_base';
import { getAiProvider } from '../ai/provider';
import { loadPrompt, renderPrompt } from '../ai/prompts';

export const REVIEW_PROMPT_ID = 'review-intelligence';
export const REVIEW_PROMPT_VERSION = 'v1';

/** FR-9.11. The cache key. */
export function hashReviewText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface AnalysisOutcome {
  reviewId: string;
  status: 'analysed' | 'unanalysed';
  /** True when the stored analysis was reused and no model was called. */
  cacheHit: boolean;
  model: string | null;
  attempts: number;
}

/**
 * Strip a fenced block, if the model wrapped its JSON in one.
 *
 * The prompt asks for bare JSON and both providers are asked for a JSON
 * response type, so this is belt and braces — but a fence is the single most
 * common way a valid answer arrives in an invalid envelope, and burning the
 * retry on it would be wasteful.
 */
function unwrapJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  return (fenced?.[1] ?? raw).trim();
}

function parseResponse(raw: string): ReviewAnalysisResponse | null {
  try {
    return reviewAnalysisResponseSchema.parse(JSON.parse(unwrapJson(raw)));
  } catch {
    // Deliberately not logged with the payload: a model response quotes the
    // review, and a review is user content (CLAUDE.md §2.2).
    return null;
  }
}

/** Completed sessions between this reviewer's student and this tutor (FR-9.5). */
async function countCompletedSessions(
  db: Executor,
  tutorId: string,
  requestedByUserId: string,
): Promise<number> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.tutorId, tutorId),
        eq(bookings.requestedByUserId, requestedByUserId),
        eq(bookings.status, 'completed'),
      ),
    );
  return rows.length;
}

async function persist(
  db: Executor,
  input: {
    reviewId: string;
    tutorId: string;
    contentHash: string;
    analysis: ReviewAnalysisResponse;
    completedSessions: number;
    rating: number;
    model: string;
  },
): Promise<void> {
  const credibility = computeCredibility(input.analysis, {
    completedSessions: input.completedSessions,
    rating: input.rating,
  });

  await db.insert(reviewAnalyses).values({
    id: newId(),
    reviewId: input.reviewId,
    contentHash: input.contentHash,
    dimensionsJson: JSON.stringify(input.analysis.dimensions),
    credibilityJson: JSON.stringify(credibility),
    topicsMentionedJson: JSON.stringify(input.analysis.topicsMentioned),
    safetyConcernFlag: toDbBool(input.analysis.safetyConcern),
    safetyConcernReason: input.analysis.safetyConcern
      ? input.analysis.safetyConcernReason
      : null,
    genericFlag: toDbBool(credibility.generic),
    contradictionFlag: toDbBool(credibility.contradiction),
    detailLevel: credibility.detailLevel,
    completedSessions: input.completedSessions,
    credibilityWeight: credibility.weight,
    model: input.model,
    promptVersion: REVIEW_PROMPT_VERSION,
    createdAt: nowIso(),
  });

  await db
    .update(reviews)
    .set({ analysisStatus: 'analysed' })
    .where(eq(reviews.id, input.reviewId));
}

/**
 * Analyse one review.
 *
 * Idempotent: a review already carrying an analysis is left alone, so a retry
 * or a double-enqueue costs nothing.
 */
export async function analyseReview(db: Executor, reviewId: string): Promise<AnalysisOutcome> {
  const rows = await db.select().from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  const review = rows[0];
  if (!review) {
    return { reviewId, status: 'unanalysed', cacheHit: false, model: null, attempts: 0 };
  }

  const existing = await db
    .select({ id: reviewAnalyses.id })
    .from(reviewAnalyses)
    .where(eq(reviewAnalyses.reviewId, reviewId))
    .limit(1);
  if (existing[0]) {
    return { reviewId, status: 'analysed', cacheHit: true, model: null, attempts: 0 };
  }

  const text = review.text ?? '';
  if (text.trim() === '') {
    // A rating with no words has nothing to classify. Not a failure — there is
    // simply no text, and calling a model to say so would be a wasted request.
    await db.update(reviews).set({ analysisStatus: 'unanalysed' }).where(eq(reviews.id, reviewId));
    return { reviewId, status: 'unanalysed', cacheHit: false, model: null, attempts: 0 };
  }

  const contentHash = hashReviewText(text);
  const completedSessions = await countCompletedSessions(
    db,
    review.tutorId,
    review.reviewerUserId,
  );

  /* --- 1. The cache (FR-9.11) ------------------------------------------- */

  const cached = await db
    .select()
    .from(reviewAnalyses)
    .where(and(eq(reviewAnalyses.contentHash, contentHash), ne(reviewAnalyses.reviewId, reviewId)))
    .limit(1);

  if (cached[0]) {
    const source = cached[0];
    // Reuse the model's classification, but recompute credibility: the weight
    // depends on *this* reviewer's completed-session count and *this* rating,
    // which are facts about the engagement rather than about the text.
    const analysis = reviewAnalysisResponseSchema.safeParse({
      dimensions: JSON.parse(source.dimensionsJson),
      topicsMentioned: JSON.parse(source.topicsMentionedJson),
      safetyConcern: source.safetyConcernFlag === 1,
      safetyConcernReason: source.safetyConcernReason ?? '',
      overallSentiment: source.contradictionFlag === 1 ? 'negative' : 'positive',
    });

    if (analysis.success) {
      await persist(db, {
        reviewId,
        tutorId: review.tutorId,
        contentHash,
        analysis: analysis.data,
        completedSessions,
        rating: review.rating,
        model: source.model,
      });
      return { reviewId, status: 'analysed', cacheHit: true, model: source.model, attempts: 0 };
    }
    // A stored analysis that no longer parses means the schema moved on. Fall
    // through and re-analyse rather than persisting something malformed.
  }

  /* --- 2. Call the model, retrying a bad response exactly once ----------- */

  const prompt = renderPrompt(loadPrompt(REVIEW_PROMPT_ID, REVIEW_PROMPT_VERSION), {
    REVIEW_TEXT: text,
  });

  const provider = getAiProvider();
  let attempts = 0;

  for (attempts = 1; attempts <= 2; attempts += 1) {
    let raw: { text: string; model: string };
    try {
      raw = await provider.complete({ prompt });
    } catch {
      continue;
    }

    const analysis = parseResponse(raw.text);
    if (!analysis) continue;

    await persist(db, {
      reviewId,
      tutorId: review.tutorId,
      contentHash,
      analysis,
      completedSessions,
      rating: review.rating,
      model: raw.model,
    });

    return { reviewId, status: 'analysed', cacheHit: false, model: raw.model, attempts };
  }

  /* --- 3. Give up, without losing the review ----------------------------- */

  await db.update(reviews).set({ analysisStatus: 'unanalysed' }).where(eq(reviews.id, reviewId));

  return { reviewId, status: 'unanalysed', cacheHit: false, model: null, attempts: attempts - 1 };
}
