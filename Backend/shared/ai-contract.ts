/**
 * The JSON decision contract — decision 7, FR-10.5, §7.2.
 *
 * Every agent turn returns **one JSON object**, validated here. Not native
 * function calling, deliberately:
 *
 *  · **Provider-agnostic by construction.** Gemini's tool schema and Groq's are
 *    not the same shape, and an agent written against either would have to be
 *    rewritten to fail over to the other. A JSON object is a JSON object.
 *  · **One model call per user turn** (§7.4). Native function calling costs a
 *    round trip to request the call and another to deliver its result; a
 *    decision object asks for the call and the application makes it, so a
 *    six-turn intake session is six calls rather than twelve. That is the
 *    difference between fitting inside a free tier and not.
 *
 * ── What the model may and may not put in here ─────────────────────────────
 * `reply` and `state` are the model's. `decision` is the model's *proposal*.
 * **Nothing numeric or binding is.** There is no field for a score, a price, a
 * rank, a date or a constraint verdict, because §7.2 puts all of those on the
 * deterministic side of the line — and a field that does not exist cannot be
 * filled in by a model having a bad day.
 */

import { z } from 'zod';

import { EXPLANATION_QUALITIES } from './competency';

/**
 * What the agent wants to happen next (FR-10.5).
 *
 * `insufficient_information` is a **valid terminal outcome**, not a failure
 * (FR-10.8): the agent says so plainly and the family is handed to manual
 * search, rather than being given a confident answer built on nothing.
 */
export const AGENT_DECISIONS = [
  'ask_user',
  'search',
  'conclude',
  'insufficient_information',
] as const;

export type AgentDecision = (typeof AGENT_DECISIONS)[number];

/**
 * The single tool an intake agent may call (FR-10.4, FR-10.7).
 *
 * **Read-only.** The agent never writes a booking, contacts a tutor or sends a
 * message. The tool is invoked once, at the end, when the gap map has settled —
 * one call per session rather than one per turn (§7.4).
 *
 * Note what the agent supplies and what it does not: it names topics, level and
 * board. It does **not** supply `genderPreference`, `maxHourlyRate` or `areaId`
 * — those are the family's hard constraints and are applied by application code
 * to the tool's result (FR-10.12, FR-16.4). There is no field here through
 * which a model could relax one.
 */
export const searchToolCallSchema = z.object({
  tool: z.literal('search_tutors'),
  topicIds: z.array(z.string().min(1)).min(1).max(10),
  levelId: z.string().min(1).optional(),
  boardId: z.string().min(1).optional(),
});

export type SearchToolCall = z.infer<typeof searchToolCallSchema>;

/**
 * One topic the agent believes is a gap, with how sure it is.
 *
 * `confidence` is the model's own hedge about its reading of a conversation,
 * which is a classification and legitimately its to give. It is never shown to
 * a family as a number and never enters a ranking.
 */
export const gapSchema = z.object({
  topicId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  /** Why, in the parent's terms. Quoted back so they can correct it. */
  rationale: z.string().max(400),
  /** True when this is an upstream prerequisite rather than the symptom. */
  isRootGap: z.boolean().default(false),
});

export const agentTurnSchema = z.object({
  /** What to show the parent. Their language, their words where quoted. */
  reply: z.string().max(2000),
  /** Carried into the next turn's prompt. The agent's own working notes. */
  state: z.record(z.string(), z.unknown()).default({}),
  decision: z.enum(AGENT_DECISIONS),
  /** Present only when `decision` is `search`. */
  toolCall: searchToolCallSchema.nullable().default(null),
  /** The agent's confidence that it has located the gap (FR-10.6). */
  confidence: z.number().min(0).max(1),
  /** Populated as the conversation narrows. */
  gaps: z.array(gapSchema).max(12).default([]),
  /** Topics it could not resolve — an explicit list, not silence (FR-10.10). */
  insufficientInfo: z.array(z.string().max(200)).max(12).default([]),
  /** Shown to the user as a collapsible step list (FR-10.9). */
  reasoningSteps: z.array(z.string().max(300)).max(10).default([]),
});

export type AgentTurn = z.infer<typeof agentTurnSchema>;

/* -------------------------------------------------------------------------
 * Hard caps — enforced in application code, never in the prompt (FR-10.6)
 * ---------------------------------------------------------------------- */

/**
 * A prompt that says "ask at most six questions" is a request. A counter in the
 * loop is a limit. FR-10.6 asks for the second, and these are it.
 */
export const AGENT_LIMITS = Object.freeze({
  /** FR-10.6: a maximum of six user turns for the diagnostic agent. */
  diagnosticMaxTurns: 6,
  /** FR-10.6: conclude at confidence of 0.75 or above. */
  concludeConfidence: 0.75,
  /** FR-11.8: a maximum of five exchanges per verification session. */
  verificationMaxTurns: 5,
  /** FR-10.10: at most three tutors in a shortlist. */
  shortlistSize: 3,
});

/* -------------------------------------------------------------------------
 * Agent 2 — competency verification (§6.11)
 * ---------------------------------------------------------------------- */

/** Three to four items per topic, scoped to the claimed level and board (FR-11.2). */
export const verificationItemSchema = z.object({
  id: z.string().max(40),
  question: z.string().max(1200),
  /** What a correct answer must contain. Used to grade, never shown. */
  expectedPoints: z.array(z.string().max(300)).min(1).max(6),
});

export type VerificationItem = z.infer<typeof verificationItemSchema>;

export const verificationItemsSchema = z.object({
  items: z.array(verificationItemSchema).min(3).max(4),
});

/**
 * The grading of one answer.
 *
 * **The model judges; it does not score.** Each field here is a classification
 * — correct or not, explained well or not, pitched at the student or at the
 * tutor (FR-11.5). The numeric verdict is computed from these by
 * `shared/competency.ts`, in code, so the same answers always produce the same
 * mark and a tutor can be told exactly why (§7.2).
 */
export const itemGradeSchema = z.object({
  itemId: z.string().max(40),
  correct: z.boolean(),
  /** Did they explain the reasoning, or state the answer? */
  explanationQuality: z.enum(EXPLANATION_QUALITIES),
  /** Pitched at the student's level, or at the tutor's own (FR-11.5)? */
  pitchedForStudent: z.boolean(),
  /** Quoted or paraphrased from the answer, for the tutor to see. */
  note: z.string().max(400),
});

export type ItemGrade = z.infer<typeof itemGradeSchema>;

export const gradingResponseSchema = z.object({
  grades: z.array(itemGradeSchema).min(1).max(4),
  /** Free text shown to the tutor with the outcome. Carries no figure. */
  reasoning: z.string().max(1500),
});

export type GradingResponse = z.infer<typeof gradingResponseSchema>;

/* -------------------------------------------------------------------------
 * Ranking narration (§6.22) and study plans (§6.26)
 * ---------------------------------------------------------------------- */

/**
 * The narration response.
 *
 * One field, deliberately. The narrator is handed a breakdown it did not
 * compute and asked to describe it; giving it anywhere else to write would
 * invite it to add a figure of its own, which FR-22.4 forbids.
 */
export const narrationResponseSchema = z.object({
  narration: z.string().min(1).max(1200),
});

/**
 * A study plan, as the model proposes it.
 *
 * **No dates.** FR-26.4 puts all date and session-count arithmetic in code, so
 * the model orders topics and the application decides when they happen. A
 * `weekOffset` is an ordinal, not a date.
 */
export const studyPlanResponseSchema = z.object({
  steps: z
    .array(
      z.object({
        topicId: z.string().min(1),
        /** 0-based ordinal. Turned into real dates by application code. */
        weekOffset: z.number().int().min(0).max(52),
        focus: z.string().max(400),
      }),
    )
    .min(1)
    .max(40),
  summary: z.string().max(1000),
});

export type StudyPlanResponse = z.infer<typeof studyPlanResponseSchema>;
export type StudyPlanStep = StudyPlanResponse['steps'][number];
