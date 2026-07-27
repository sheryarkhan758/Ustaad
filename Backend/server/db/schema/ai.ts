/**
 * AI session state and outputs — specification §9.8, §7.
 *
 * HTTP is stateless; the agents are not (FR-10.2).  These tables hold the
 * per-turn state, the outputs, and — on every row — the model identifier and
 * prompt version that produced it, so the README's disclosure of the prompt
 * instructions is verifiable rather than merely asserted (§7.3).
 *
 * The architectural principle these tables are subordinate to (§7.2,
 * CLAUDE.md §2.9):
 *
 *   **The model classifies, narrates and sequences.  Application code
 *   computes, validates and enforces.**
 *
 * So: `gap_map_json` is a proposal, and `matched_tutor_ids_json` is what
 * survived hard-constraint filtering *in code* afterwards (FR-10.12).
 * `narration` may contain no figure absent from `breakdown_json` (FR-22.4).
 * `plan_json` is re-validated against the prerequisite graph and regenerated on
 * violation (FR-26.2).  `verdict` on a verification attempt is appealable and
 * overridable by a human (SEC-18).  Nothing here is final because a model said
 * so.
 *
 * All user text reaching these tables — a parent's description of a symptom, a
 * tutor's answer — is **data, not instructions** (SEC-11).
 */

import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { EMPTY_JSON_ARRAY } from '../../../shared/db-values';
import { boolCol, createdAt, jsonCol, pk, timestampCol } from './_common';

import { LANGS } from './reference';
import { studentProfiles, users } from './identity';
import { levels, subjects, topics } from './reference';
import { tutorProfiles } from './tutor';

/** The two multi-turn agents (§7.1). */
export const AGENT_TYPES = ['diagnostic_intake', 'competency_verification'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/**
 * `insufficient_information` is a **valid terminal outcome**, not a failure
 * (FR-10.8) — the session hands off to manual search and is logged as unmet
 * demand (FR-10.13).  `provider_failed` is the degraded path (FR-10.11), which
 * presents manual search with a notice rather than an error state.
 */
export const AGENT_SESSION_STATUSES = [
  'active',
  'concluded',
  'insufficient_information',
  'abandoned',
  'provider_failed',
] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: pk(),
    type: text('type', { enum: AGENT_TYPES }).notNull(),
    userId: text('user_id').references(() => users.id),
    studentProfileId: text('student_profile_id').references(() => studentProfiles.id),
    /** The stated objective, in the user's own words.  Stored unchanged. */
    goal: text('goal'),
    /** Full turn-by-turn transcript.  Persisted per turn (FR-10.2). */
    transcriptJson: jsonCol('transcript_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** The agent's working notes between turns. */
    scratchpadJson: jsonCol('scratchpad_json'),
    status: text('status', { enum: AGENT_SESSION_STATUSES }).notNull().default('active'),
    /** Compared against the hard cap enforced in code, not in the prompt (FR-10.6, FR-11.8). */
    turnCount: integer('turn_count').notNull().default(0),
    model: text('model'),
    promptVersion: text('prompt_version'),
    /**
     * A stored session replayed on the demonstration path, costing zero live
     * calls (§7.4, §6.15).  Demonstration data is synthetic.
     */
    isDemoSeed: boolCol('is_demo_seed').notNull().default(0),
    createdAt: createdAt(),
    completedAt: timestampCol('completed_at'),
  },
  (t) => [
    index('idx_agent_sessions_user').on(t.userId, t.type),
    index('idx_agent_sessions_type_status').on(t.type, t.status),
    index('idx_agent_sessions_demo').on(t.isDemoSeed, t.type),
  ],
);

/**
 * Output of the diagnostic intake agent — FR-10.10.
 *
 * `gap_map_json` holds root gaps with per-topic confidence, produced by walking
 * the prerequisite graph.  `matched_tutor_ids_json` holds the shortlist **after**
 * gender, budget, area and engagement-type constraints have been applied in
 * application code to the tool result (FR-10.12, FR-16.4) — the agent proposes
 * a shortlist, code decides what may appear in it.
 */
export const diagnostics = sqliteTable(
  'diagnostics',
  {
    id: pk(),
    agentSessionId: text('agent_session_id')
      .notNull()
      .references(() => agentSessions.id, { onDelete: 'cascade' }),
    studentProfileId: text('student_profile_id').references(() => studentProfiles.id),
    subjectId: text('subject_id').references(() => subjects.id),
    gapMapJson: jsonCol('gap_map_json').notNull(),
    /** Topics the agent could not resolve — an explicit list, not silence (FR-10.10). */
    insufficientInfoJson: jsonCol('insufficient_info_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    /** Post-filter shortlist, at most three (FR-10.10). */
    matchedTutorIdsJson: jsonCol('matched_tutor_ids_json')
      
      .notNull()
      .$defaultFn(() => EMPTY_JSON_ARRAY),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_diagnostics_session').on(t.agentSessionId),
    index('idx_diagnostics_student').on(t.studentProfileId, t.createdAt),
  ],
);

/** Per topic, never per subject; partial passes are permitted (FR-11.6). */
export const VERIFICATION_VERDICTS = ['pass', 'partial', 'fail', 'inconclusive'] as const;
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

/**
 * Competency assessment attempt — §6.11, §6.28.
 *
 * `adminOverride` and `overrideReason` exist because of SEC-18: **an automated
 * verdict affecting a person's livelihood is never final without a route to
 * human review.**  A tutor may appeal, and an administrator may overturn the
 * machine.  Prior items are retained so a re-attempt does not repeat them
 * (FR-11.4).
 */
export const verificationAttempts = sqliteTable(
  'verification_attempts',
  {
    id: pk(),
    agentSessionId: text('agent_session_id')
      .notNull()
      .references(() => agentSessions.id, { onDelete: 'cascade' }),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    itemsJson: jsonCol('items_json').notNull(),
    responsesJson: jsonCol('responses_json').notNull(),
    verdict: text('verdict', { enum: VERIFICATION_VERDICTS }).notNull(),
    /** 0–100, from the grading rubric in FR-11.5. */
    score: real('score'),
    reasoning: text('reasoning'),
    isAppeal: boolCol('is_appeal').notNull().default(0),
    /** Human override of an automated verdict (SEC-18, FR-28.x). */
    adminOverride: boolCol('admin_override').notNull().default(0),
    overrideReason: text('override_reason'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    createdAt: createdAt(),
  },
  (t) => [
    // FR-11.4: retrieve prior items for this tutor and topic.
    index('idx_verification_tutor_topic').on(t.tutorId, t.topicId, t.createdAt),
    index('idx_verification_session').on(t.agentSessionId),
    // Administrator appeal queue.
    index('idx_verification_appeals').on(t.isAppeal, t.createdAt),
  ],
);

/**
 * Cached narration of a deterministic ranking breakdown — §6.22.
 *
 * The score is computed by code and hashed; the narration is regenerated only
 * when that hash changes (§7.4).  The narration prompt is forbidden from
 * introducing any figure not present in `breakdown_json` (FR-22.4) — the model
 * explains the arithmetic, it does not perform it.
 */
export const rankingExplanations = sqliteTable(
  'ranking_explanations',
  {
    id: pk(),
    tutorId: text('tutor_id')
      .notNull()
      .references(() => tutorProfiles.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    /** Keys the cache. Changes only when the underlying signals change. */
    scoreHash: text('score_hash').notNull(),
    breakdownJson: jsonCol('breakdown_json')
      
      .notNull(),
    narration: text('narration').notNull(),
    lang: text('lang', { enum: LANGS }).notNull(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    createdAt: createdAt(),
  },
  (t) => [
    // One cached narration per (tutor, topic, score, language).
    uniqueIndex('idx_ranking_explanations_cache').on(t.tutorId, t.topicId, t.scoreHash, t.lang),
  ],
);

/**
 * Generated study plan — §6.26.
 *
 * `prereqValidated` records that the plan's ordering was checked against the
 * prerequisite graph **in code after generation**, and regenerated if it
 * violated it (FR-26.2).  All session-count and date arithmetic is done in code
 * (FR-26.4), never by the model.
 */
export const studyPlans = sqliteTable(
  'study_plans',
  {
    id: pk(),
    diagnosticId: text('diagnostic_id')
      .notNull()
      .references(() => diagnostics.id, { onDelete: 'cascade' }),
    studentProfileId: text('student_profile_id').references(() => studentProfiles.id),
    levelId: text('level_id').references(() => levels.id),
    /** ISO `YYYY-MM-DD` text — date arithmetic happens in TypeScript (§2.1). */
    targetDate: text('target_date'),
    planJson: jsonCol('plan_json').notNull(),
    prereqValidated: boolCol('prereq_validated').notNull().default(0),
    model: text('model'),
    promptVersion: text('prompt_version'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_study_plans_diagnostic').on(t.diagnosticId),
    index('idx_study_plans_student').on(t.studentProfileId, t.createdAt),
  ],
);

export type AgentSession = typeof agentSessions.$inferSelect;
export type Diagnostic = typeof diagnostics.$inferSelect;
export type VerificationAttempt = typeof verificationAttempts.$inferSelect;
export type RankingExplanation = typeof rankingExplanations.$inferSelect;
export type StudyPlan = typeof studyPlans.$inferSelect;

/**
 * Per-call usage log and the daily budget guard — §7.4, NFR-5.
 *
 * §7.4 is an architectural constraint, not a nice-to-have: the whole AI layer
 * has to operate inside a permanent free inference tier, and the estimate is
 * under eight hundred requests across development, testing and assessment. A
 * budget you cannot see is a budget you cannot keep, so every call is recorded
 * — including the ones served from cache, which is how the caching claim is
 * checkable rather than asserted.
 *
 * `day` is ISO `YYYY-MM-DD` in UTC, so the guard's window is a plain string
 * comparison on an indexed column and needs no date function (PORTABILITY
 * rule 1).
 *
 * Records no prompt and no response: both quote user content (CLAUDE.md §2.2).
 */
export const aiCallLog = sqliteTable(
  'ai_call_log',
  {
    id: pk(),
    /** ISO `YYYY-MM-DD`, UTC. The budget window. */
    day: text('day').notNull(),
    /** `diagnostic_intake`, `competency_verification`, `narration`, `study_plan`. */
    component: text('component').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /**
     * Millionths of a US dollar. Integer, for the same reason money is integer
     * paisa: a float accumulates error and rounds differently across engines.
     * Zero on a free tier, and still worth recording — the point is the shape
     * of the spend, not the invoice.
     */
    estimatedCostMicros: integer('estimated_cost_micros').notNull().default(0),
    /** 1 when served from cache or a replay. No provider was contacted. */
    cacheHit: boolCol('cache_hit').notNull().default(0),
    /** 1 when the primary failed and a fallback answered. */
    failedOver: boolCol('failed_over').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // The budget guard's only query: how many live calls today?
    index('idx_ai_call_log_day').on(t.day, t.cacheHit),
    index('idx_ai_call_log_component').on(t.component, t.day),
  ],
);

export type AiCallLog = typeof aiCallLog.$inferSelect;
