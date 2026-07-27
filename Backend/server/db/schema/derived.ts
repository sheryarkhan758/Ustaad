/**
 * Derived and materialised statistics — specification §9.4.
 *
 * **Written by background jobs only.  Never by a request handler.**
 * (NFR-15, decision 9, CLAUDE.md §2.8.)
 *
 * These three tables exist so that search does no arithmetic.  A search request
 * reads indexed integer and real columns and nothing else: no aggregate, no
 * subquery over reviews or bookings, and no AI call.  That is what keeps it
 * inside the 500 ms budget over a 500-tutor dataset (NFR-1), and it is why
 * ranking is reproducible across runs and auditable against stored signals
 * (§7.2).
 *
 * Every value here is produced by deterministic code from stored structured
 * signals.  **The model never writes a row in this file** — it may narrate a
 * breakdown it is handed (§6.22), and that narration lives in
 * `ranking_explanations`, not here.
 *
 * Two re-identification thresholds are enforced in the recompute code, not in
 * the UI (NFR-16):
 *   · rate benchmarks suppressed below a cohort of 4 (SEC-17);
 *   · unmet demand suppressed below a cohort of 3 (SEC-16, `matching.ts`).
 *
 * Note on numeric types: money stays integer paisa. Scores, rates and ratios
 * are `real`, because they are computed quantities rather than currency and a
 * fractional confirmation rate is meaningful where a fractional rupee is not.
 */

import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { nowIso } from '../../../shared/db-values';
import { jsonCol, paisa, timestampCol } from './_common';

import { TEACHING_MODES } from '../../../shared/rates';
import { areas, levels, subjects, topics } from './reference';
import { tutorProfiles } from './tutor';

/**
 * Per-topic composite score — §6.22, FR-7.5.
 *
 * `scoreHash` keys the ranking-explanation cache: the narration is regenerated
 * only when the underlying signals change (§7.4).  Keyed by (tutor, topic)
 * because per-topic scores are aggregated separately from any overall composite
 * (FR-9.9) — a tutor strong in Organic Chemistry is not thereby strong in
 * Thermodynamics.
 */
export const tutorScores = sqliteTable(
  'tutor_scores',
  {
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    compositeScore: real('composite_score').notNull(),
    /** The signal table shown to a user alongside the narration (OBJ-14). */
    dimensionScoresJson: jsonCol('dimension_scores_json')
      
      .notNull(),
    reviewCount: integer('review_count').notNull().default(0),
    /** Credibility-weighted count — generic reviews are down-weighted, never
     *  hidden and never deleted (FR-9.6). */
    weightedReviewCount: real('weighted_review_count').notNull().default(0),
    /**
     * Whether the competency assessment for this topic is currently passed and
     * unexpired.  Materialised here so a topic-filtered search is an indexed
     * join — `tutor_subject_claims.topic_ids_json` is a serialised blob and no
     * query may reach inside it (PORTABILITY.md rule 3).
     */
    competencyVerified: integer('competency_verified').notNull().default(0),
    /** ISO `YYYY-MM-DD`. Copied from the claim so search need not join it. */
    expiresOn: text('expires_on'),
    scoreHash: text('score_hash').notNull(),
    computedAt: timestampCol('computed_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.tutorId, t.topicId] }),
    // The ranking sort: best scores for a topic, read straight off the index.
    index('idx_tutor_scores_ranking').on(t.topicId, t.compositeScore),
    index('idx_tutor_scores_hash').on(t.scoreHash),
    // The topic-filtered search path: topic → verified tutors, best first.
    index('idx_tutor_scores_topic_verified').on(t.topicId, t.competencyVerified, t.compositeScore),
  ],
);

/**
 * Reliability statistics — §6.17.
 *
 * `safetyDeclinesExcluded` is the count of declines removed from the
 * confirmation-rate denominator under SEC-21 / FR-29.14.  It is stored rather
 * than merely applied so that the figure can be audited: a tutor is entitled to
 * see that her safety declines were in fact excluded, and an administrator is
 * entitled to check that the exclusion was not abused.
 *
 * `bookingBasis` is the denominator actually used, so every published rate can
 * be reconstructed from stored numbers alone.
 */
export const tutorReliability = sqliteTable(
  'tutor_reliability',
  {
    tutorId: text('tutor_id')
      .primaryKey()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    /** Minutes between request and first response (FR-17.1). */
    medianResponseMins: integer('median_response_mins'),
    /** Confirmed ÷ bookingBasis (FR-17.2). */
    confirmationRate: real('confirmation_rate'),
    completedCount: integer('completed_count').notNull().default(0),
    noShowCount: integer('no_show_count').notNull().default(0),
    cancellationRate: real('cancellation_rate'),
    /** Sessions started within the agreed slot ÷ sessions attended (FR-17.x). */
    onTimeRate: real('on_time_rate'),
    /** Completed ÷ confirmed. A confirmed booking that never happened counts. */
    completionRate: real('completion_rate'),
    /** Declines excluded under a declared safety constraint (SEC-21). */
    safetyDeclinesExcluded: integer('safety_declines_excluded').notNull().default(0),
    /** The denominator used, after the SEC-21 exclusion. */
    bookingBasis: integer('booking_basis').notNull().default(0),
    computedAt: timestampCol('computed_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [index('idx_tutor_reliability_computed').on(t.computedAt)],
);

/**
 * Rate benchmarks — §6.19, FR-19.6.
 *
 * `cohortSize` is stored because the read path must suppress any cohort below
 * four (SEC-17, NFR-16): with three tutors in a cell, a published median lets
 * an individual tutor's rate be inferred.  The suppression is applied in the
 * query layer against this column, not by omitting the row — the row is needed
 * to know that the cohort exists and is too small.
 */
export const rateBenchmarks = sqliteTable(
  'rate_benchmarks',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    mode: text('mode', { enum: TEACHING_MODES }).notNull(),
    /** Paisa per hour — the normalised basis from `shared/rates.ts` (§2.7). */
    medianHourly: paisa('median_hourly').notNull(),
    /** Paisa. The interquartile range, so a family sees spread not just a point. */
    p25Hourly: paisa('p25_hourly'),
    p75Hourly: paisa('p75_hourly'),
    cohortSize: integer('cohort_size').notNull(),
    /**
     * Whether this cell may be shown. Materialised rather than decided at read
     * time so the SEC-17 threshold is applied once, by the job, and cannot be
     * forgotten by a caller.
     */
    published: integer('published').notNull().default(0),
    /** How many of the cohort are identity-verified tutors. */
    verifiedCount: integer('verified_count').notNull().default(0),
    computedAt: timestampCol('computed_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [
    // One benchmark per cell; the recompute job upserts on this key.
    uniqueIndex('idx_rate_benchmarks_cell').on(t.subjectId, t.levelId, t.areaId, t.mode),
    // The SEC-17 suppression filter reads this.
    index('idx_rate_benchmarks_cohort').on(t.cohortSize),
  ],
);

export type TutorScore = typeof tutorScores.$inferSelect;
export type TutorReliability = typeof tutorReliability.$inferSelect;
export type RateBenchmark = typeof rateBenchmarks.$inferSelect;

/**
 * Per-tutor search signals — the query-independent half of ranking.
 *
 * Not in §9.4, and added deliberately. `tutor_scores` is keyed by
 * (tutor, topic), so a search with no topic filter would have to aggregate
 * across a tutor's topics to get one number — and NFR-15 and CLAUDE.md §2.8
 * forbid a request computing an aggregate. Materialising the roll-up here is
 * what keeps that promise honest rather than nominal.
 *
 * Everything in this table is independent of the query. The signals that are
 * *not* — area proximity, and where a rate sits against the local benchmark —
 * are read from `area_adjacency` and `rate_benchmarks`, which are themselves
 * materialised. Nothing in the search path computes a statistic.
 *
 * Written by `server/jobs/tutor-scores.ts` only.
 */
export const tutorSearchSignals = sqliteTable(
  'tutor_search_signals',
  {
    tutorId: text('tutor_id')
      .primaryKey()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),

    /** 0–1. Roll-up of the per-topic composites, credibility-weighted. */
    overallScore: real('overall_score').notNull().default(0),
    /** 0–1. The tutor's strongest topic, so a generalist is not flattened. */
    bestTopicScore: real('best_topic_score').notNull().default(0),

    /** How many artefacts the administrator recorded as checked (FR-6.5). */
    artefactsCheckedCount: integer('artefacts_checked_count').notNull().default(0),
    /** Topics with a live, unexpired competency pass. */
    verifiedTopicCount: integer('verified_topic_count').notNull().default(0),

    reviewCount: integer('review_count').notNull().default(0),
    /** Generic reviews are down-weighted, never hidden and never deleted (FR-9.6). */
    weightedReviewCount: real('weighted_review_count').notNull().default(0),

    /** ISO-8601. Latest booking response, session or profile edit. */
    lastActiveAt: text('last_active_at'),
    /** 0–1, decayed from `lastActiveAt` by the job. */
    recencyScore: real('recency_score').notNull().default(0),

    /** Paisa. Cheapest normalised hourly across all this tutor's rates. */
    minNormalisedHourly: paisa('min_normalised_hourly'),

    computedAt: timestampCol('computed_at')
      .notNull()
      .$defaultFn(nowIso),
  },
  (t) => [
    // The default ranked sweep reads this ordering directly.
    index('idx_search_signals_overall').on(t.overallScore),
    index('idx_search_signals_price').on(t.minNormalisedHourly),
  ],
);

export type TutorSearchSignals = typeof tutorSearchSignals.$inferSelect;
