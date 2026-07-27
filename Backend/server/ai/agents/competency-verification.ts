/**
 * Agent 2 — competency verification (§6.11).
 *
 * A tutor claims a topic. This generates three or four items for it, grades the
 * answers, and records a verdict. Passing marks `claim_status = 'verified'`;
 * that is the difference between appearing in a search for Organic Chemistry
 * and not.
 *
 * ── Two rules, both enforced here rather than asked for in the prompt ──────
 *
 * **1. The model classifies; `shared/competency.ts` computes.** The model never
 *    emits a score or a verdict (§7.2). It reports, per item, whether the
 *    substance was right, how well it was explained, and whether it was pitched
 *    at a student. The number comes from the rubric, in code, so two tutors who
 *    answered equally well get the same mark and an appeal has something a
 *    human can actually check (SEC-18).
 *
 * **2. No claim is verified without a recorded verdict row.** `claim_status` is
 *    only ever written by `applyVerdict`, in the same call that inserts the
 *    `verification_attempts` row it cites. There is no other path to
 *    `'verified'` — grep for it.
 */

import { and, desc, eq } from 'drizzle-orm';

import {
  gradingResponseSchema,
  verificationItemsSchema,
  type VerificationItem,
} from '../../../shared/ai-contract';
import {
  computeCompetency,
  describeVerdict,
  type CompetencyResult,
} from '../../../shared/competency';
import { newId, nowIso } from '../../../shared/db-values';
import { agentSessions, verificationAttempts } from '../../db/schema/ai';
import { boards, levels, topics as topicsTable } from '../../db/schema/reference';
import { tutorSubjectClaims } from '../../db/schema/tutor';
import type { Executor } from '../../repositories/_base';
import { callModel } from '../call';
import { loadPrompt, renderPrompt } from '../prompts';

export const VERIFICATION_PROMPT_VERSION = 'v1';

/** Twelve months, in days — FR-28.1. Applied in TypeScript, never in SQL. */
const CLAIM_VALIDITY_DAYS = 365;

export class VerificationFlowError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VerificationFlowError';
    this.status = status;
    this.code = code;
  }
}

async function curriculumLabels(db: Executor, claim: { subjectId: string; levelId: string; boardId: string }) {
  const [level] = await db.select().from(levels).where(eq(levels.id, claim.levelId)).limit(1);
  const [board] = await db.select().from(boards).where(eq(boards.id, claim.boardId)).limit(1);
  return { level: level?.name ?? claim.levelId, board: board?.name ?? claim.boardId };
}

/**
 * Start an attempt: generate the items and open a session.
 *
 * FR-11.4 — a re-attempt must not be the same test. Prior items for this
 * (tutor, topic) are read out of `verification_attempts` and passed to the
 * prompt as a do-not-repeat list. Enforced afterwards too: any item whose text
 * matches one already used is dropped before the tutor sees it, because "please
 * avoid these" is a request, not a guarantee.
 */
export async function startVerificationAttempt(
  db: Executor,
  input: { tutorId: string; claimId: string; topicId: string; isAppeal?: boolean },
): Promise<{ sessionId: string; items: VerificationItem[] }> {
  const [claim] = await db
    .select()
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.id, input.claimId))
    .limit(1);

  if (!claim || claim.tutorId !== input.tutorId) {
    throw new VerificationFlowError(404, 'claim_not_found', 'no such subject claim for this tutor');
  }

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, input.topicId)).limit(1);
  if (!topic) {
    throw new VerificationFlowError(404, 'topic_not_found', 'no such topic');
  }

  const prior = await db
    .select()
    .from(verificationAttempts)
    .where(
      and(
        eq(verificationAttempts.tutorId, input.tutorId),
        eq(verificationAttempts.topicId, input.topicId),
      ),
    )
    .orderBy(desc(verificationAttempts.createdAt))
    .limit(5);

  const priorQuestions = prior.flatMap((attempt) =>
    (JSON.parse(attempt.itemsJson) as VerificationItem[]).map((i) => i.question),
  );

  const { level, board } = await curriculumLabels(db, claim);

  const prompt = renderPrompt(loadPrompt('competency-verification', VERIFICATION_PROMPT_VERSION), {
    MODE: 'generate',
    TOPIC: `${topic.id} — ${topic.name}`,
    LEVEL: level,
    BOARD: board,
    PRIOR_ITEMS: priorQuestions.length > 0 ? priorQuestions.map((q) => `- ${q}`).join('\n') : '(none)',
    ANSWERS: '(none — you are generating)',
  });

  const { value, model } = await callModel(db, {
    component: 'competency_verification',
    prompt,
    schema: verificationItemsSchema,
  });

  // FR-11.4 in code. The prompt asked; this decides.
  const used = new Set(priorQuestions.map(normalise));
  const items = value.items.filter((i) => !used.has(normalise(i.question)));

  if (items.length === 0) {
    throw new VerificationFlowError(
      503,
      'no_fresh_items',
      'could not produce items that differ from the previous attempt',
    );
  }

  const sessionId = newId();
  await db.insert(agentSessions).values({
    id: sessionId,
    type: 'competency_verification',
    userId: null,
    studentProfileId: null,
    goal: `verify ${input.tutorId} on ${input.topicId}`,
    transcriptJson: JSON.stringify([{ role: 'agent', text: 'items generated' }]),
    scratchpadJson: JSON.stringify({
      tutorId: input.tutorId,
      claimId: input.claimId,
      topicId: input.topicId,
      isAppeal: input.isAppeal === true,
      items,
      model,
    }),
    status: 'active',
    turnCount: 1,
    promptVersion: VERIFICATION_PROMPT_VERSION,
    createdAt: nowIso(),
  });

  // `expectedPoints` is the marking scheme. The tutor gets the question only.
  return {
    sessionId,
    items: items.map((i) => ({ ...i, expectedPoints: [] })),
  };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface VerificationOutcome {
  attemptId: string;
  verdict: CompetencyResult['verdict'];
  score: number;
  /** The sentence shown to the tutor. Its figure is the stored figure. */
  message: string;
  reasoning: string;
  claimStatus: string;
  perItem: CompetencyResult['perItem'];
}

/**
 * Grade the answers, compute the verdict in code, record it, and only then
 * touch `claim_status`.
 *
 * The ordering is the invariant: the attempt row is inserted first, so a claim
 * can never be `verified` without the row that justifies it existing. If the
 * claim update failed, the worst outcome is an unverified claim with a passing
 * attempt on record — recoverable, and visible. The reverse would be a badge
 * with nothing behind it, which is the one thing §2.5 exists to prevent.
 */
export async function submitVerificationAnswers(
  db: Executor,
  input: { sessionId: string; tutorId: string; answers: { itemId: string; answer: string }[] },
): Promise<VerificationOutcome> {
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, input.sessionId))
    .limit(1);

  if (!session || session.type !== 'competency_verification') {
    throw new VerificationFlowError(404, 'session_not_found', 'no such verification session');
  }
  if (session.status !== 'active') {
    throw new VerificationFlowError(409, 'session_closed', 'this assessment has already been graded');
  }

  const scratch = JSON.parse(session.scratchpadJson ?? '{}') as {
    tutorId: string;
    claimId: string;
    topicId: string;
    isAppeal: boolean;
    items: VerificationItem[];
  };

  // Ownership, server-side (NFR-6). A session id is not an authorisation.
  if (scratch.tutorId !== input.tutorId) {
    throw new VerificationFlowError(403, 'not_your_assessment', 'this assessment belongs to another tutor');
  }

  const [claim] = await db
    .select()
    .from(tutorSubjectClaims)
    .where(eq(tutorSubjectClaims.id, scratch.claimId))
    .limit(1);
  if (!claim) {
    throw new VerificationFlowError(404, 'claim_not_found', 'the subject claim no longer exists');
  }

  const [topic] = await db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.id, scratch.topicId))
    .limit(1);

  const answered = scratch.items.map((item) => ({
    item,
    answer: input.answers.find((a) => a.itemId === item.id)?.answer ?? '',
  }));

  const { level, board } = await curriculumLabels(db, claim);

  const prompt = renderPrompt(loadPrompt('competency-verification', VERIFICATION_PROMPT_VERSION), {
    MODE: 'grade',
    TOPIC: `${scratch.topicId} — ${topic?.name ?? scratch.topicId}`,
    LEVEL: level,
    BOARD: board,
    PRIOR_ITEMS: '(not relevant when grading)',
    ANSWERS: answered
      .map(
        ({ item, answer }) =>
          `## item ${item.id}\nQ: ${item.question}\nExpected: ${item.expectedPoints.join('; ')}\nAnswer: ${answer}`,
      )
      .join('\n\n'),
  });

  const { value, model } = await callModel(db, {
    component: 'competency_verification',
    prompt,
    schema: gradingResponseSchema,
  });

  // Only grades for items we actually asked. A model that invents an item id
  // must not be able to inflate the mean.
  const known = new Set(scratch.items.map((i) => i.id));
  const grades = value.grades.filter((g) => known.has(g.itemId));

  /* --- The score. Computed here, never received. ------------------------- */
  const result = computeCompetency(grades);

  const attemptId = newId();
  await db.insert(verificationAttempts).values({
    id: attemptId,
    agentSessionId: input.sessionId,
    tutorId: scratch.tutorId,
    topicId: scratch.topicId,
    itemsJson: JSON.stringify(scratch.items),
    responsesJson: JSON.stringify({ answers: answered.map((a) => ({ itemId: a.item.id, answer: a.answer })), grades }),
    verdict: result.verdict,
    score: result.score,
    reasoning: value.reasoning,
    isAppeal: scratch.isAppeal ? 1 : 0,
    adminOverride: 0,
    model,
    promptVersion: VERIFICATION_PROMPT_VERSION,
    createdAt: nowIso(),
  });

  /* --- Only now may the claim move. -------------------------------------- */
  const claimStatus = await applyVerdict(db, {
    claimId: scratch.claimId,
    attemptId,
    result,
  });

  await db
    .update(agentSessions)
    .set({ status: 'concluded', turnCount: session.turnCount + 1, completedAt: nowIso() })
    .where(eq(agentSessions.id, input.sessionId));

  return {
    attemptId,
    verdict: result.verdict,
    score: result.score,
    message: describeVerdict(result, topic?.name ?? scratch.topicId),
    reasoning: value.reasoning,
    claimStatus,
    perItem: result.perItem,
  };
}

/**
 * **The only writer of `claim_status = 'verified'` in the codebase.**
 *
 * It takes an `attemptId` because it refuses to run without one: a verified
 * claim always has a `verification_attempts` row behind it, and the badge on
 * the profile can always be traced back to the answers that earned it.
 */
async function applyVerdict(
  db: Executor,
  input: { claimId: string; attemptId: string; result: CompetencyResult },
): Promise<string> {
  if (!input.attemptId) {
    throw new VerificationFlowError(
      500,
      'no_recorded_verdict',
      'a claim cannot be verified without a recorded attempt',
    );
  }

  if (input.result.verdict !== 'pass') {
    // A failed or partial attempt leaves the claim exactly where it was. It is
    // never downgraded — an earlier pass stands until it expires (FR-28.1).
    const [current] = await db
      .select({ status: tutorSubjectClaims.claimStatus })
      .from(tutorSubjectClaims)
      .where(eq(tutorSubjectClaims.id, input.claimId))
      .limit(1);
    return current?.status ?? 'asserted';
  }

  // Expiry computed in TypeScript and stored as ISO `YYYY-MM-DD` text (§2.1).
  const expiresOn = new Date(Date.now() + CLAIM_VALIDITY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  await db
    .update(tutorSubjectClaims)
    .set({
      claimStatus: 'verified',
      verifiedAt: nowIso(),
      verifiedScore: input.result.score,
      expiresOn,
    })
    .where(eq(tutorSubjectClaims.id, input.claimId));

  return 'verified';
}
