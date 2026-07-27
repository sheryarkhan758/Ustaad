/**
 * Study-plan generation — §6.26, FR-26.1 to FR-26.6.
 *
 * A diagnostic produced a gap map. This turns it into an ordered plan running
 * up to an examination date.
 *
 * ── What the model does and does not produce ───────────────────────────────
 * The model **orders topics**. It emits a `weekOffset` — an ordinal — and a
 * focus line, and nothing else. Every date in the stored plan is computed here,
 * in TypeScript, from the target date (FR-26.4, §7.2). A family plans a term
 * around these dates; they have to be arithmetic, not generation.
 *
 * ── The check that gives this module its point ─────────────────────────────
 * **A topic may never be scheduled before one of its prerequisites.** The
 * ordering is validated against `topic_prerequisites` in code, after
 * generation. On a violation the plan is regenerated, not repaired and not
 * stored (FR-26.2) — a plan that teaches quadratics before factorisation is
 * precisely the failure §2.4 describes, and storing it with a warning would
 * pass the failure to the family.
 *
 * `prereq_validated` records that the check ran and passed. Nothing writes it
 * true except `generateStudyPlan`, below, after `findPrereqViolation` returned
 * null.
 */

import { eq, inArray } from 'drizzle-orm';

import { studyPlanResponseSchema, type StudyPlanStep } from '../../shared/ai-contract';
import { newId, nowIso } from '../../shared/db-values';
import { diagnostics, studyPlans } from '../db/schema/ai';
import { topicPrerequisites, topics as topicsTable } from '../db/schema/reference';
import type { Executor } from '../repositories/_base';
import { callModel } from './call';
import { loadPrompt, renderPrompt } from './prompts';

export const STUDY_PLAN_PROMPT_VERSION = 'v1';

/** How many times a violating plan is regenerated before giving up (§7.4). */
export const MAX_PLAN_ATTEMPTS = 2;

export class StudyPlanError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StudyPlanError';
    this.status = status;
    this.code = code;
  }
}

export interface PrereqViolation {
  topicId: string;
  prerequisiteTopicId: string;
  /** Human-readable, and fed back into the regeneration prompt. */
  reason: string;
}

/**
 * The validator. Pure over its inputs, so it is testable without a model.
 *
 * Transitive by construction: the graph is walked to closure first, so placing
 * quadratics before signed-number arithmetic is caught even when factorisation
 * sits between them and only the direct edges are stored.
 *
 * A prerequisite the plan does not schedule at all is **not** a violation. The
 * student may already have it; the diagnostic is what decides that, not this.
 */
export function findPrereqViolation(
  steps: StudyPlanStep[],
  edges: { topicId: string; prerequisiteTopicId: string }[],
): PrereqViolation | null {
  const direct = new Map<string, string[]>();
  for (const edge of edges) {
    const list = direct.get(edge.topicId) ?? [];
    list.push(edge.prerequisiteTopicId);
    direct.set(edge.topicId, list);
  }

  // Transitive closure by depth-first walk, memoised. The seed data is checked
  // for cycles at seed time, and the `seen` set keeps this terminating anyway.
  const closureCache = new Map<string, Set<string>>();
  const closureOf = (topicId: string, seen = new Set<string>()): Set<string> => {
    const memo = closureCache.get(topicId);
    if (memo) return memo;
    if (seen.has(topicId)) return new Set();
    seen.add(topicId);

    const all = new Set<string>();
    for (const prereq of direct.get(topicId) ?? []) {
      all.add(prereq);
      for (const deeper of closureOf(prereq, seen)) all.add(deeper);
    }
    closureCache.set(topicId, all);
    return all;
  };

  const earliest = new Map<string, number>();
  for (const step of steps) {
    const current = earliest.get(step.topicId);
    if (current === undefined || step.weekOffset < current) {
      earliest.set(step.topicId, step.weekOffset);
    }
  }

  // Deterministic order, so the same bad plan always reports the same first
  // violation — the message goes back into the prompt and into a test.
  const ordered = [...steps].sort(
    (a, b) => a.weekOffset - b.weekOffset || a.topicId.localeCompare(b.topicId),
  );

  for (const step of ordered) {
    for (const prereq of [...closureOf(step.topicId)].sort()) {
      const prereqWeek = earliest.get(prereq);
      if (prereqWeek === undefined) continue; // not in the plan — see above
      if (prereqWeek >= step.weekOffset) {
        return {
          topicId: step.topicId,
          prerequisiteTopicId: prereq,
          reason:
            `${step.topicId} is scheduled in week ${step.weekOffset}, but its prerequisite ` +
            `${prereq} is in week ${prereqWeek}. A prerequisite must come strictly earlier.`,
        };
      }
    }
  }

  return null;
}

export interface PlannedStep extends StudyPlanStep {
  /** ISO `YYYY-MM-DD`. Computed here, never by the model (FR-26.4). */
  startDate: string;
  endDate: string;
}

/** All date arithmetic for the plan, in one place, in TypeScript (§2.1). */
export function datesForSteps(steps: StudyPlanStep[], startDate: string): PlannedStep[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  if (Number.isNaN(start)) {
    throw new StudyPlanError(400, 'bad_start_date', 'startDate must be ISO YYYY-MM-DD');
  }

  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return steps.map((step) => {
    const from = start + step.weekOffset * 7 * 86_400_000;
    return { ...step, startDate: iso(from), endDate: iso(from + 6 * 86_400_000) };
  });
}

/** Whole weeks between two ISO dates, floored at 1. */
export function weeksAvailable(startDate: string, targetDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(target)) {
    throw new StudyPlanError(400, 'bad_date', 'dates must be ISO YYYY-MM-DD');
  }
  return Math.max(1, Math.floor((target - start) / (7 * 86_400_000)));
}

export interface StudyPlanResult {
  planId: string;
  steps: PlannedStep[];
  summary: string;
  /** How many generations it took. > 1 means a violation was rejected. */
  attempts: number;
  prereqValidated: boolean;
}

export async function generateStudyPlan(
  db: Executor,
  input: {
    diagnosticId: string;
    /** ISO `YYYY-MM-DD`. */
    startDate: string;
    targetDate: string;
    levelId?: string | null;
    replay?: string[] | null;
  },
): Promise<StudyPlanResult> {
  const [diagnostic] = await db
    .select()
    .from(diagnostics)
    .where(eq(diagnostics.id, input.diagnosticId))
    .limit(1);

  if (!diagnostic) {
    throw new StudyPlanError(404, 'diagnostic_not_found', 'no such diagnostic');
  }

  const gapMap = JSON.parse(diagnostic.gapMapJson) as {
    gaps: { topicId: string; confidence: number; rationale: string; isRootGap: boolean }[];
  };

  if (gapMap.gaps.length === 0) {
    throw new StudyPlanError(
      422,
      'no_gaps',
      'this diagnostic located no gaps, so there is nothing to sequence',
    );
  }

  const gapTopicIds = gapMap.gaps.map((g) => g.topicId);
  const edges = await db.select().from(topicPrerequisites);

  // The graph the plan is validated against, restricted to what is reachable
  // from the gaps — the same graph goes into the prompt, so the model is
  // ordering against exactly what the validator will check.
  const relevant = new Set(gapTopicIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edge of edges) {
      if (relevant.has(edge.topicId) && !relevant.has(edge.prerequisiteTopicId)) {
        relevant.add(edge.prerequisiteTopicId);
        grew = true;
      }
    }
  }

  const names = new Map(
    (await db.select().from(topicsTable).where(inArray(topicsTable.id, [...relevant]))).map(
      (t) => [t.id, t.name] as const,
    ),
  );

  const graphText = [...relevant]
    .sort()
    .map((id) => {
      const prereqs = edges
        .filter((e) => e.topicId === id && relevant.has(e.prerequisiteTopicId))
        .map((e) => e.prerequisiteTopicId);
      return `- ${id} — ${names.get(id) ?? id}${
        prereqs.length > 0 ? ` (requires: ${prereqs.join(', ')})` : ''
      }`;
    })
    .join('\n');

  const weeks = weeksAvailable(input.startDate, input.targetDate);

  /* --- Generate, validate, regenerate on violation (FR-26.2) -------------- */

  let steps: StudyPlanStep[] | null = null;
  let summary = '';
  let model = '';
  let attempts = 0;
  let lastViolation: PrereqViolation | null = null;

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
    attempts = attempt;

    const prompt = renderPrompt(loadPrompt('study-plan', STUDY_PLAN_PROMPT_VERSION), {
      WEEKS: String(weeks),
      GAP_MAP: JSON.stringify(gapMap.gaps, null, 2),
      PREREQUISITES:
        graphText +
        (lastViolation
          ? `\n\nYour previous plan was rejected: ${lastViolation.reason} Order it correctly this time.`
          : ''),
    });

    const result = await callModel(db, {
      component: 'study_plan',
      prompt,
      schema: studyPlanResponseSchema,
      replay: input.replay?.[attempt - 1] ?? null,
    });

    const candidate = result.value.steps.filter((s) => relevant.has(s.topicId));
    const violation = findPrereqViolation(candidate, edges);

    if (violation === null && candidate.length > 0) {
      steps = candidate;
      summary = result.value.summary;
      model = result.model;
      break;
    }

    lastViolation = violation;
  }

  if (steps === null) {
    // Rejected, not stored. The caller shows the gap map and the manual path.
    throw new StudyPlanError(
      503,
      'plan_violates_prerequisites',
      lastViolation
        ? `could not produce a valid ordering: ${lastViolation.reason}`
        : 'could not produce a usable plan',
    );
  }

  const planned = datesForSteps(
    [...steps].sort((a, b) => a.weekOffset - b.weekOffset || a.topicId.localeCompare(b.topicId)),
    input.startDate,
  );

  const planId = newId();
  await db.insert(studyPlans).values({
    id: planId,
    diagnosticId: input.diagnosticId,
    studentProfileId: diagnostic.studentProfileId,
    levelId: input.levelId ?? null,
    targetDate: input.targetDate,
    planJson: JSON.stringify({ steps: planned, summary, weeks }),
    // True only on this path, only after the validator returned null.
    prereqValidated: 1,
    model,
    promptVersion: STUDY_PLAN_PROMPT_VERSION,
    createdAt: nowIso(),
  });

  return { planId, steps: planned, summary, attempts, prereqValidated: true };
}
