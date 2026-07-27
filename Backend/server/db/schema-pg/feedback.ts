// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/feedback.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reviews and review intelligence — specification §9.8, §6.9.
 *
 * A review is permitted only against a **completed** booking, one per booking
 * (FR-9.1), which is what makes every review traceable to a real interaction
 * (SEC-5).  Star ratings compress to a meaningless average across this whole
 * category of platform; the signal lives in the text, and `review_analyses`
 * is where that text becomes comparable structure (§2.5).
 *
 * Two rules govern the analysis table:
 *
 *  · **The model classifies; it does not decide.**  Dimension extraction and
 *    credibility signals are model output; the weighting applied to them in
 *    ranking is deterministic code (§7.2, CLAUDE.md §2.9).
 *  · **A safety-concern flag is never public.**  It routes privately to the
 *    administrator queue and never triggers automatic notification to the
 *    tutor (FR-9.8, SEC-9).
 */

import { index, integer, real, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { EMPTY_JSON_ARRAY } from '../../../shared/db-values';
import { ANALYSIS_STATUSES } from '../../../shared/review-analysis';
import { boolCol, createdAt, jsonCol, pk } from './_common';

import { bookings } from './booking';
import { users } from './identity';
import { tutorProfiles } from './tutor';

/** Who wrote it.  A minor never can — they hold no account (SEC-1). */
export const REVIEWER_ROLES = ['parent', 'student'] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

export const reviews = pgTable(
  'reviews',
  {
    id: pk(),
    /** One review per booking (FR-9.1). */
    bookingId: text('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id),
    reviewerUserId: text('reviewer_user_id')
      .notNull()
      .references(() => users.id),
    reviewerRole: text('reviewer_role', { enum: REVIEWER_ROLES }).notNull(),
    /** 1–5. */
    rating: integer('rating').notNull(),
    /**
     * Free text.  Urdu script, Roman Urdu, English or any mixture of the three
     * within one sentence (FR-9.2).  **Stored byte-for-byte as entered and
     * never machine translated** — translating a reviewer's words would
     * misrepresent them (decision 13, CLAUDE.md §2.10).
     */
    text: text('text'),
    /**
     * `pending` → `analysed` | `unanalysed`.
     *
     * Lives on the review, not on the analysis, so that a review whose analysis
     * has not run — or definitively failed — is still a complete row. A bad
     * model response must never lose the review (FR-9.3).
     */
    analysisStatus: text('analysis_status', { enum: ANALYSIS_STATUSES })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_reviews_booking').on(t.bookingId),
    // Public profile: this tutor's reviews, newest first.
    index('idx_reviews_tutor').on(t.tutorId, t.createdAt),
    index('idx_reviews_reviewer').on(t.reviewerUserId),
  ],
);

export const reviewAnalyses = pgTable(
  'review_analyses',
  {
    id: pk(),
    reviewId: text('review_id')
      .notNull()
      .unique()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 of the review text.  Keys the analysis cache (FR-9.11): identical
     * text reuses a stored analysis at zero token cost (§7.4).
     */
    contentHash: text('content_hash').notNull(),
    /** Eight structured dimensions with quoted evidence (FR-9.4). */
    dimensionsJson: jsonCol('dimensions_json')
      
      .notNull(),
    /** Completed-session basis, detail level, generic flag, contradiction flag (FR-9.5). */
    credibilityJson: jsonCol('credibility_json')
      
      .notNull(),
    topicsMentionedJson: jsonCol('topics_mentioned_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /**
     * Routes privately to the administrator queue.  **Never displayed publicly
     * and never automatically disclosed to the tutor** (FR-9.8, SEC-9).
     */
    safetyConcernFlag: boolCol('safety_concern_flag').notNull().default(0),
    /** Never public. Read only from the administrator queue (FR-9.8, SEC-9). */
    safetyConcernReason: text('safety_concern_reason'),
    /**
     * FR-9.6. Down-weighted in ranking, **never hidden and never deleted** —
     * the flag changes a weight, not visibility.
     */
    genericFlag: boolCol('generic_flag').notNull().default(0),
    /** FR-9.7. Surfaced **publicly** where the stars and the text disagree. */
    contradictionFlag: boolCol('contradiction_flag').notNull().default(0),
    /** Mean specificity across the dimensions the reviewer addressed. */
    detailLevel: real('detail_level').notNull().default(0),
    /** Completed sessions the reviewer had with this tutor (FR-9.5). */
    completedSessions: integer('completed_sessions').notNull().default(0),
    /** Weight applied in ranking.  Computed by deterministic code, not the model. */
    credibilityWeight: real('credibility_weight').notNull().default(1),
    /** Per-record provenance (FR-9.10, §7.3). */
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idx_review_analyses_review').on(t.reviewId),
    // The content-hash cache lookup.
    index('idx_review_analyses_hash').on(t.contentHash),
    // Administrator safety queue.
    index('idx_review_analyses_safety').on(t.safetyConcernFlag, t.createdAt),
    // The FR-9.7 public surface, and the FR-9.6 weighting sweep.
    index('idx_review_analyses_flags').on(t.contradictionFlag, t.genericFlag),
  ],
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ReviewAnalysis = typeof reviewAnalyses.$inferSelect;
