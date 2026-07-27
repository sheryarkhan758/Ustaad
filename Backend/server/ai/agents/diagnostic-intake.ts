/**
 * Agent 1 — diagnostic intake (§6.10).
 *
 * A multi-turn conversation that locates the gap, which is usually upstream of
 * the symptom (§2.4). The transcript and the agent's scratchpad are persisted
 * on `agent_sessions` every turn, because HTTP is stateless and the agent is
 * not (FR-10.2) — which is also what makes a session resumable and replayable.
 *
 * ── The line this module exists to hold ────────────────────────────────────
 * **The agent proposes a shortlist. Application code decides what is in it.**
 *
 * When a family requires a female tutor, that constraint is applied by
 * `searchTutors` in the SQL predicate — *after* the model has spoken, to the
 * result of its tool call (FR-10.12, FR-16.4). It is not in the prompt, it is
 * not in the tool-call schema, and there is no field through which a model
 * could relax it. §2.1 is why: for a family whose daughter cannot travel, a
 * male tutor in the shortlist is not a mildly wrong suggestion, it is the
 * platform being unusable.
 *
 * Every hard cap is enforced here, in the loop, never in the prompt (FR-10.6).
 */

import { eq } from 'drizzle-orm';

import {
  AGENT_LIMITS,
  agentTurnSchema,
  type AgentTurn,
} from '../../../shared/ai-contract';
import { newId, nowIso } from '../../../shared/db-values';
import type { SearchQuery } from '../../../shared/search';
import { searchQuerySchema } from '../../../shared/search';
import { agentSessions, diagnostics } from '../../db/schema/ai';
import {
  topicPrerequisites,
  topics as topicsTable,
} from '../../db/schema/reference';
import type { Executor } from '../../repositories/_base';
import { searchTutors } from '../../repositories/search';
import { recordUnmetDemand } from '../../services/unmet-demand';
import { AiBudgetExceededError } from '../budget';
import { callModel } from '../call';
import { loadPrompt, renderPrompt } from '../prompts';

export const DIAGNOSTIC_PROMPT_VERSION = 'v1';

export interface IntakeConstraints {
  /**
   * The family's hard constraints. Passed to `searchTutors`, **never** into the
   * prompt — the model is not asked to respect them and is not trusted to.
   */
  genderPreference?: SearchQuery['genderPreference'];
  cityId?: string;
  areaId?: string;
  maxHourlyRate?: number;
  mode?: SearchQuery['mode'];
}

export interface IntakeTurnResult {
  sessionId: string;
  reply: string;
  decision: AgentTurn['decision'];
  turnCount: number;
  confidence: number;
  reasoningSteps: string[];
  gaps: AgentTurn['gaps'];
  insufficientInfo: string[];
  /** Post-filter. At most three (FR-10.10). */
  shortlist: { tutorId: string; slug: string; score: number }[];
  /** True when the AI path was unavailable and the family gets manual search. */
  degradedToManualSearch: boolean;
  finished: boolean;
}

/**
 * Curriculum context injected into the prompt rather than fetched by a tool
 * call (FR-10.3).
 *
 * §7.4: this roughly halves the call count for this agent. The graph is static
 * seeded reference data, so there is nothing to be gained by making the model
 * ask for it a piece at a time.
 */
async function buildCurriculumContext(db: Executor, subjectId?: string): Promise<string> {
  const rows = subjectId
    ? await db.select().from(topicsTable).where(eq(topicsTable.subjectId, subjectId))
    : await db.select().from(topicsTable).limit(120);

  const edges = await db.select().from(topicPrerequisites);
  const ids = new Set(rows.map((t) => t.id));

  const lines = rows.map((topic) => {
    const prereqs = edges
      .filter((e) => e.topicId === topic.id && ids.has(e.prerequisiteTopicId))
      .map((e) => e.prerequisiteTopicId);
    return `- ${topic.id} — ${topic.name}${
      prereqs.length > 0 ? ` (requires: ${prereqs.join(', ')})` : ''
    }`;
  });

  return lines.join('\n');
}

export async function startIntakeSession(
  db: Executor,
  input: { userId: string | null; studentProfileId: string | null; goal: string },
): Promise<string> {
  const id = newId();
  await db.insert(agentSessions).values({
    id,
    type: 'diagnostic_intake',
    userId: input.userId,
    studentProfileId: input.studentProfileId,
    goal: input.goal,
    transcriptJson: '[]',
    scratchpadJson: '{}',
    status: 'active',
    turnCount: 0,
    promptVersion: DIAGNOSTIC_PROMPT_VERSION,
    createdAt: nowIso(),
  });
  return id;
}

interface TranscriptEntry {
  role: 'parent' | 'agent';
  text: string;
}

/**
 * One turn.
 *
 * The caps in FR-10.6 are applied here, around the model call, and are not
 * requests made of the model:
 *   · six user turns maximum;
 *   · conclude at confidence ≥ 0.75;
 *   · conclude if the same topic is probed twice.
 */
export async function runIntakeTurn(
  db: Executor,
  input: {
    sessionId: string;
    message: string;
    subjectId?: string;
    constraints?: IntakeConstraints;
  },
): Promise<IntakeTurnResult> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, input.sessionId))
    .limit(1);
  const session = rows[0];
  if (!session) throw new Error(`no such intake session: ${input.sessionId}`);

  const transcript = JSON.parse(session.transcriptJson) as TranscriptEntry[];
  const scratchpad = JSON.parse(session.scratchpadJson ?? '{}') as Record<string, unknown>;
  transcript.push({ role: 'parent', text: input.message });

  const prompt = renderPrompt(loadPrompt('diagnostic-intake', DIAGNOSTIC_PROMPT_VERSION), {
    CURRICULUM: await buildCurriculumContext(db, input.subjectId),
    TRANSCRIPT: transcript.map((t) => `${t.role}: ${t.text}`).join('\n'),
    STATE: JSON.stringify(scratchpad),
    MESSAGE: input.message,
  });

  let turn: AgentTurn;

  try {
    // A seeded demonstration session replays with no live call (§6.15, §7.4).
    const replay = session.isDemoSeed === 1 ? nextReplay(scratchpad) : null;
    const result = await callModel(db, {
      component: 'diagnostic_intake',
      prompt,
      schema: agentTurnSchema,
      replay,
    });
    turn = result.value;
  } catch (error) {
    // FR-10.11: **any** failure of the AI path — an exhausted budget, every
    // provider down, an unparseable response — hands the family manual search
    // with an explanation. Never an error state. Someone who has just typed out
    // their child's difficulty and gets a stack trace has been failed twice.
    const reason =
      error instanceof AiBudgetExceededError
        ? 'the guided intake has reached its limit for today'
        : 'the guided intake is unavailable at the moment';

    await db
      .update(agentSessions)
      .set({ status: 'provider_failed', completedAt: nowIso() })
      .where(eq(agentSessions.id, input.sessionId));

    return {
      sessionId: input.sessionId,
      reply:
        `Sorry — ${reason}. You can search directly instead; the filters do everything the ` +
        'guide would have done, it just takes a few more taps.',
      decision: 'insufficient_information',
      turnCount: session.turnCount,
      confidence: 0,
      reasoningSteps: [],
      gaps: [],
      insufficientInfo: [],
      shortlist: [],
      degradedToManualSearch: true,
      finished: true,
    };
  }

  transcript.push({ role: 'agent', text: turn.reply });
  const turnCount = session.turnCount + 1;

  /* --- Hard caps, in code (FR-10.6) -------------------------------------- */

  const probed = new Set([
    ...((scratchpad.probed as string[] | undefined) ?? []),
    ...turn.gaps.map((g) => g.topicId),
  ]);
  const repeatedProbe =
    turn.gaps.length > 0 &&
    turn.gaps.every((g) => ((scratchpad.probed as string[] | undefined) ?? []).includes(g.topicId));

  const mustStop =
    turnCount >= AGENT_LIMITS.diagnosticMaxTurns ||
    turn.confidence >= AGENT_LIMITS.concludeConfidence ||
    repeatedProbe;

  const decision: AgentTurn['decision'] =
    turn.decision === 'ask_user' && mustStop
      ? turn.gaps.length > 0
        ? 'search'
        : 'insufficient_information'
      : turn.decision;

  /* --- The tool call, and the filters applied to its RESULT --------------- */

  let shortlist: IntakeTurnResult['shortlist'] = [];

  if (decision === 'search' && (turn.toolCall || turn.gaps.length > 0)) {
    const topicIds = turn.toolCall?.topicIds ?? turn.gaps.map((g) => g.topicId);

    // The constraints come from the family, not from the model. `searchTutors`
    // applies gender as a hard SQL exclusion before anything is ranked, so a
    // non-conforming tutor is absent rather than filtered out afterwards.
    const query = searchQuerySchema.parse({
      topicIds: topicIds.slice(0, 10),
      levelId: turn.toolCall?.levelId,
      boardId: turn.toolCall?.boardId,
      genderPreference: input.constraints?.genderPreference ?? 'no_preference',
      cityId: input.constraints?.cityId,
      areaId: input.constraints?.areaId,
      maxHourlyRate: input.constraints?.maxHourlyRate,
      mode: input.constraints?.mode,
      limit: AGENT_LIMITS.shortlistSize,
    });

    const response = await searchTutors(db, query);
    shortlist = response.results.map((r) => ({
      tutorId: r.tutor.id,
      slug: r.tutor.slug,
      score: r.score,
    }));
  }

  const finished =
    decision === 'conclude' || decision === 'insufficient_information' || decision === 'search';

  /* --- Persist, so the session can be resumed and replayed (FR-10.2) ------ */

  await db
    .update(agentSessions)
    .set({
      transcriptJson: JSON.stringify(transcript),
      // The replay cursor and script must survive the write. `turn.state` is
      // the model's own working notes and knows nothing about either, so
      // spreading it alone silently reset a seeded session to its first stored
      // turn — every turn replayed turn one, and the demonstration looked like
      // an agent that could not hear you (§6.15, FR-15.7).
      scratchpadJson: JSON.stringify({
        ...turn.state,
        probed: [...probed],
        ...carryReplayState(scratchpad),
      }),
      turnCount,
      status: finished
        ? decision === 'insufficient_information'
          ? 'insufficient_information'
          : 'concluded'
        : 'active',
      completedAt: finished ? nowIso() : null,
    })
    .where(eq(agentSessions.id, input.sessionId));

  /* --- FR-24.1: a failed intake becomes supply intelligence -------------- */

  // A subject is required: `unmet_demand.subject_id` is a foreign key, and a
  // record that cannot say what was being looked for is not intelligence.
  if (
    finished &&
    input.subjectId &&
    (decision === 'insufficient_information' || shortlist.length === 0)
  ) {
    // No session id, no user id, no student profile id — `recordUnmetDemand`
    // has nowhere to put one (FR-24.2). What survives is the shape of the
    // demand, which is the part a tutor can act on.
    await recordUnmetDemand(db, {
      subjectId: input.subjectId,
      topicIds: turn.gaps.map((g) => g.topicId),
      levelId: turn.toolCall?.levelId ?? null,
      boardId: turn.toolCall?.boardId ?? null,
      areaId: input.constraints?.areaId ?? null,
      genderPreference: input.constraints?.genderPreference ?? 'no_preference',
      budgetMaxPaisa: input.constraints?.maxHourlyRate ?? null,
      reason: decision === 'insufficient_information' ? 'insufficient_information' : 'no_matches',
    });
  }

  if (finished) {
    await db.insert(diagnostics).values({
      id: newId(),
      agentSessionId: input.sessionId,
      studentProfileId: session.studentProfileId,
      subjectId: input.subjectId ?? null,
      gapMapJson: JSON.stringify({ gaps: turn.gaps, confidence: turn.confidence }),
      insufficientInfoJson: JSON.stringify(turn.insufficientInfo),
      // Post-filter. What the family may actually be shown.
      matchedTutorIdsJson: JSON.stringify(shortlist.map((s) => s.tutorId)),
      createdAt: nowIso(),
    });
  }

  return {
    sessionId: input.sessionId,
    reply: turn.reply,
    decision,
    turnCount,
    confidence: turn.confidence,
    reasoningSteps: turn.reasoningSteps,
    gaps: turn.gaps,
    insufficientInfo: turn.insufficientInfo,
    shortlist,
    degradedToManualSearch: false,
    finished,
  };
}

/** The next stored turn of a seeded demonstration session (§6.15). */
function nextReplay(scratchpad: Record<string, unknown>): string | null {
  const script = scratchpad.replayScript as string[] | undefined;
  const index = (scratchpad.replayIndex as number | undefined) ?? 0;
  return script?.[index] ?? null;
}

/**
 * The replay fields to carry into the next scratchpad, with the cursor advanced.
 *
 * Kept separate from `turn.state` because the two have different owners: the
 * state is the model's, and the model must not be able to rewind or extend its
 * own replay script by emitting these keys. Returns nothing at all for a live
 * session, so an ordinary scratchpad never grows demonstration fields.
 *
 * The cursor stops at the end of the script rather than running past it.
 * `nextReplay` then returns `null`, `callModel` falls through to the provider —
 * or, under `DEMO_REPLAY=true`, fails closed (§7.4).
 */
function carryReplayState(scratchpad: Record<string, unknown>): Record<string, unknown> {
  const script = scratchpad.replayScript as string[] | undefined;
  if (!Array.isArray(script)) return {};

  const index = (scratchpad.replayIndex as number | undefined) ?? 0;
  return {
    replayScript: script,
    replayIndex: Math.min(index + 1, script.length),
    // Presentation metadata the demonstration panel reads. Preserved for the
    // same reason: a turn must not make a seeded session unaddressable.
    ...(scratchpad.demoKey === undefined ? {} : { demoKey: scratchpad.demoKey }),
    ...(scratchpad.title === undefined ? {} : { title: scratchpad.title }),
    ...(scratchpad.summary === undefined ? {} : { summary: scratchpad.summary }),
    ...(scratchpad.requirement === undefined ? {} : { requirement: scratchpad.requirement }),
    ...(scratchpad.exhibit === undefined ? {} : { exhibit: scratchpad.exhibit }),
  };
}
