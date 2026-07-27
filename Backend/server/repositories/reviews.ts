/**
 * Review aggregate — reviews and their structured analyses.
 *
 * Two rules are enforced at this boundary rather than left to callers:
 *
 *  · Review text is returned **exactly as stored** (§2.10). Nothing here
 *    normalises, transliterates or translates it.
 *  · `safetyConcernFlag` is carried on the analysis, and the public listing
 *    query does not expose it. A safety concern routes privately to the
 *    administrator queue and never notifies the tutor (FR-9.8, SEC-9).
 */

import { desc, eq } from 'drizzle-orm';

import { fromDbBool, fromDbJson, fromDbTimestamp, newId, nowIso, toDbBool, toDbJson } from '../../shared/db-values';
import {
  reviewAnalysisResponseSchema,
  toPublicDimensions,
  type AnalysisStatus,
  type PublicReviewDimension,
} from '../../shared/review-analysis';
import { reviewAnalyses, reviews } from '../db/schema/feedback';
import type { ReviewerRole } from '../db/schema/feedback';
import { type Executor, NotFoundError } from './_base';

export interface ReviewRecord {
  id: string;
  bookingId: string;
  tutorId: string;
  reviewerUserId: string;
  reviewerRole: ReviewerRole;
  rating: number;
  /** Urdu, Roman Urdu, English or a mixture. Byte-for-byte as written. */
  text: string | null;
  createdAt: Date;
}

export interface ReviewAnalysisRecord {
  id: string;
  reviewId: string;
  contentHash: string;
  dimensions: Record<string, unknown>;
  credibility: Record<string, unknown>;
  topicsMentioned: string[];
  safetyConcernFlag: boolean;
  credibilityWeight: number;
  model: string;
  promptVersion: string;
  createdAt: Date;
}

type StoredReview = typeof reviews.$inferSelect;

function toDomain(row: StoredReview): ReviewRecord {
  return {
    id: row.id,
    bookingId: row.bookingId,
    tutorId: row.tutorId,
    reviewerUserId: row.reviewerUserId,
    reviewerRole: row.reviewerRole,
    rating: row.rating,
    text: row.text,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

export async function createReview(
  db: Executor,
  input: {
    bookingId: string;
    tutorId: string;
    reviewerUserId: string;
    reviewerRole: ReviewerRole;
    rating: number;
    text?: string | null;
  },
): Promise<ReviewRecord> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new RangeError(`rating must be an integer 1–5, received ${input.rating}`);
  }

  const id = newId();
  await db.insert(reviews).values({
    id,
    bookingId: input.bookingId,
    tutorId: input.tutorId,
    reviewerUserId: input.reviewerUserId,
    reviewerRole: input.reviewerRole,
    rating: input.rating,
    text: input.text ?? null,
    createdAt: nowIso(),
  });

  return getReviewOrThrow(db, id);
}

export async function findReview(db: Executor, id: string): Promise<ReviewRecord | null> {
  const rows = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
  return rows[0] ? toDomain(rows[0]) : null;
}

export async function getReviewOrThrow(db: Executor, id: string): Promise<ReviewRecord> {
  const found = await findReview(db, id);
  if (!found) throw new NotFoundError('review', id);
  return found;
}

export interface PublicReview extends ReviewRecord {
  /** FR-9.7. Shown where the stars and the words disagree. */
  contradiction: boolean;
  /**
   * FR-9.6. The review is **shown**, and marked as carrying little signal.
   *
   * Exposed deliberately. Without it a client cannot honour the distinction
   * FR-9.6 rests on: a generic review is down-weighted in ranking and **never
   * hidden**, so the surface that renders it has to be able to say which one it
   * is. Withholding the flag would leave a profile with two options — show it
   * as though it were as informative as a detailed review, or drop it — and
   * both are wrong.
   */
  lowSignal: boolean;
  /**
   * The weight this review carries in ranking, 0–1. Computed by deterministic
   * code, never by the model (§2.9).
   */
  credibilityWeight: number;
  /** How many completed sessions the reviewer had with this tutor (FR-9.5). */
  completedSessions: number;
  /** The reviewer's own words, per dimension. Empty until analysis runs. */
  dimensions: PublicReviewDimension[];
  analysisStatus: AnalysisStatus;
}

/**
 * The public profile listing — FR-9.8, SEC-9.
 *
 * **A safety-flagged review is absent from this result set.** It is not
 * redacted, not collapsed and not marked "under review": any of those would
 * tell the tutor that a report exists, and SEC-9 says the tutor is never
 * automatically notified. It goes to the administrator queue instead and
 * nowhere else.
 *
 * A **generic** review is present and always will be. FR-9.6 down-weights it in
 * ranking and does not hide it — the two are different, and conflating them
 * would quietly delete the reviews of people who wrote briefly.
 */
export async function listPublicReviewsForTutor(
  db: Executor,
  tutorId: string,
): Promise<PublicReview[]> {
  const rows = await db
    .select({ review: reviews, analysis: reviewAnalyses })
    .from(reviews)
    .leftJoin(reviewAnalyses, eq(reviewAnalyses.reviewId, reviews.id))
    .where(eq(reviews.tutorId, tutorId))
    .orderBy(desc(reviews.createdAt));

  return rows
    // The exclusion. An unanalysed review has no flag and is shown; a flagged
    // one never reaches the caller.
    .filter((row) => row.analysis?.safetyConcernFlag !== 1)
    .map((row) => {
      const analysis = row.analysis;
      let dimensions: PublicReviewDimension[] = [];

      if (analysis) {
        const parsed = reviewAnalysisResponseSchema.safeParse({
          dimensions: JSON.parse(analysis.dimensionsJson),
          topicsMentioned: JSON.parse(analysis.topicsMentionedJson),
          safetyConcern: false,
          safetyConcernReason: '',
          overallSentiment: 'mixed',
        });
        if (parsed.success) dimensions = toPublicDimensions(parsed.data);
      }

      return {
        ...toDomain(row.review),
        contradiction: analysis?.contradictionFlag === 1,
        lowSignal: analysis?.genericFlag === 1,
        credibilityWeight: analysis?.credibilityWeight ?? 1,
        completedSessions: analysis?.completedSessions ?? 0,
        dimensions,
        analysisStatus: row.review.analysisStatus,
      };
    });
}

/**
 * Every review, including safety-flagged ones. **Administrators only.**
 *
 * Named so that reaching for it is a deliberate act rather than something that
 * happens by picking the shorter function name.
 */
export async function listAllReviewsForTutorAsAdmin(
  db: Executor,
  tutorId: string,
): Promise<ReviewRecord[]> {
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.tutorId, tutorId))
    .orderBy(desc(reviews.createdAt));
  return rows.map(toDomain);
}

/** The administrator safety queue (FR-9.8, SEC-9). */
export async function listSafetyConcernReviews(db: Executor): Promise<
  { review: ReviewRecord; reason: string | null }[]
> {
  const rows = await db
    .select({ review: reviews, analysis: reviewAnalyses })
    .from(reviews)
    .innerJoin(reviewAnalyses, eq(reviewAnalyses.reviewId, reviews.id))
    .where(eq(reviewAnalyses.safetyConcernFlag, 1))
    .orderBy(desc(reviews.createdAt));

  return rows.map((row) => ({
    review: toDomain(row.review),
    reason: row.analysis.safetyConcernReason,
  }));
}

export async function deleteReview(db: Executor, id: string): Promise<void> {
  await db.delete(reviews).where(eq(reviews.id, id));
}

/* -------------------------------------------------------------------------
 * Analyses
 * ---------------------------------------------------------------------- */

export async function saveReviewAnalysis(
  db: Executor,
  input: {
    reviewId: string;
    contentHash: string;
    dimensions: Record<string, unknown>;
    credibility: Record<string, unknown>;
    topicsMentioned: string[];
    safetyConcernFlag: boolean;
    credibilityWeight?: number;
    model: string;
    promptVersion: string;
  },
): Promise<ReviewAnalysisRecord> {
  const id = newId();
  await db.insert(reviewAnalyses).values({
    id,
    reviewId: input.reviewId,
    contentHash: input.contentHash,
    dimensionsJson: toDbJson(input.dimensions) ?? '{}',
    credibilityJson: toDbJson(input.credibility) ?? '{}',
    topicsMentionedJson: toDbJson(input.topicsMentioned) ?? '[]',
    safetyConcernFlag: toDbBool(input.safetyConcernFlag),
    credibilityWeight: input.credibilityWeight ?? 1,
    model: input.model,
    promptVersion: input.promptVersion,
    createdAt: nowIso(),
  });

  const rows = await db.select().from(reviewAnalyses).where(eq(reviewAnalyses.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('review analysis', id);

  return {
    id: row.id,
    reviewId: row.reviewId,
    contentHash: row.contentHash,
    dimensions: fromDbJson<Record<string, unknown>>(row.dimensionsJson, {}),
    credibility: fromDbJson<Record<string, unknown>>(row.credibilityJson, {}),
    topicsMentioned: fromDbJson<string[]>(row.topicsMentionedJson, []),
    safetyConcernFlag: fromDbBool(row.safetyConcernFlag),
    credibilityWeight: row.credibilityWeight,
    model: row.model,
    promptVersion: row.promptVersion,
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

/** The FR-9.11 content-hash cache: identical text costs zero tokens. */
export async function findAnalysisByContentHash(
  db: Executor,
  contentHash: string,
): Promise<{ id: string; reviewId: string } | null> {
  const rows = await db
    .select({ id: reviewAnalyses.id, reviewId: reviewAnalyses.reviewId })
    .from(reviewAnalyses)
    .where(eq(reviewAnalyses.contentHash, contentHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteReviewAnalysis(db: Executor, id: string): Promise<void> {
  await db.delete(reviewAnalyses).where(eq(reviewAnalyses.id, id));
}
