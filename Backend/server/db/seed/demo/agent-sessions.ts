/**
 * The five recorded agent sessions — §6.15, FR-15.1 to FR-15.7.
 *
 * FR-15.7 is the requirement that matters here: *"Demonstration scenarios
 * replay stored agent sessions, making zero live API calls on the demonstration
 * path."* §15's risk table names the reason — a free-tier rate limit reached
 * during assessment would otherwise take the demonstration down at the worst
 * possible moment, and no amount of "it usually works" recovers that.
 *
 * So every scenario below is a **stored transcript**. `replayScript` holds the
 * exact JSON the model returned when the session was recorded; on replay,
 * `callModel` short-circuits to it and never opens a socket. With
 * `DEMO_REPLAY=true` a live call becomes impossible rather than merely unlikely
 * (§7.4) — `callModel` fails closed when no stored response covers a call.
 *
 * The five map to FR-15.2 through FR-15.6:
 *
 *  A `diagnostic-root-gap`   FR-15.2 — stated Mathematics weakness resolving to
 *                            an integer-operations root gap, with matched tutors
 *  B `review-analysis`       FR-15.3 — see `reviews.ts`; the two reviews are
 *                            seeded rows rather than a transcript, because the
 *                            analyser is not a conversation
 *  C `competency-chemistry`  FR-15.4 — passes Organic Chemistry, fails
 *                            Thermodynamics, badge withheld for the failed topic
 *  D `ranking-explanation`   FR-15.5 — narration of a deterministic breakdown
 *  E `female-home-karachi`   FR-15.6 — the gender constraint enforced, not ranked
 *
 * B, D and E carry no multi-turn transcript: they are single-shot or pure-code
 * paths. They are recorded here anyway so that one endpoint serves all five and
 * the client has a uniform shape to render.
 *
 * Every word below is invented.
 */

import type { AgentSessionStatus, AgentType } from '../../schema/ai';

export interface DemoAgentSession {
  /** Stable, URL-safe. The client asks for a scenario by this key. */
  key: string;
  /** FR-15.1's panel entry. */
  title: string;
  /** One line, shown on the card. */
  summary: string;
  /** The requirement this scenario exists to demonstrate. */
  requirement: string;
  type: AgentType;
  status: AgentSessionStatus;
  goal: string;
  model: string;
  promptVersion: string;
  transcript: { role: 'parent' | 'tutor' | 'agent'; text: string }[];
  /**
   * One stored model response per user turn, serialised exactly as the provider
   * returned it. Replayed in order and parsed by the same Zod schema a live
   * response would be.
   */
  replayScript: string[];
  diagnostic?: {
    subjectId: string;
    gapMap: { gaps: { topicId: string; confidence: number; rationale: string; isRootGap: boolean }[]; confidence: number };
    /** Tutor slugs, resolved to ids at seed time. */
    matchedSlugs: string[];
  };
  /** Rendered beside the transcript, for the scenarios that have one. */
  exhibit?: Record<string, unknown>;
}

const INTEGERS = 'math-matric-sindh-signed-number-arithmetic';
const FACTORISATION = 'math-matric-sindh-algebraic-factorisation';
const QUADRATICS = 'math-matric-sindh-quadratic-equations';

export const DEMO_AGENT_SESSIONS: DemoAgentSession[] = [
  /* =====================================================================
   * Scenario A — FR-15.2
   * ================================================================== */
  {
    key: 'diagnostic-root-gap',
    title: 'A stated weakness resolves to a root gap',
    summary:
      'A parent says their daughter "is weak in Maths". Three questions later the agent has located the actual gap three years upstream, and the shortlist is filtered in code afterwards.',
    requirement: 'FR-15.2',
    type: 'diagnostic_intake',
    status: 'concluded',
    goal: 'My daughter is weak in Maths',
    model: 'gemini-2.0-flash',
    promptVersion: 'diagnostic-intake.v1',
    transcript: [
      { role: 'parent', text: 'My daughter is weak in Maths. She is in Matric, Sindh Board.' },
      {
        role: 'agent',
        text: 'That helps, thank you. "Weak in Maths" usually turns out to be one specific thing rather than the whole subject. When she gets a question wrong, is it more often that she does not know where to start, or that she starts correctly and the answer comes out wrong?',
      },
      { role: 'parent', text: 'She starts, but the answer is wrong. Especially in algebra chapters.' },
      {
        role: 'agent',
        text: 'That points away from the algebra itself. One more question: when she factorises something like x² − 5x + 6, does she get the signs right — the −2 and −3?',
      },
      { role: 'parent', text: 'No, this is exactly the problem. She writes +2 and +3 and does not see it.' },
      {
        role: 'agent',
        text: 'Then the gap is not quadratics. It is signed-number arithmetic, which sits three topics upstream and is assumed by everything after it. A tutor who drills quadratics will not fix this. I have found three verified tutors who work on prerequisite gaps rather than syllabus order.',
      },
    ],
    replayScript: [
      JSON.stringify({
        reply:
          'That helps, thank you. "Weak in Maths" usually turns out to be one specific thing rather than the whole subject. When she gets a question wrong, is it more often that she does not know where to start, or that she starts correctly and the answer comes out wrong?',
        state: { subject: 'mathematics', level: 'matric', board: 'sindh-board', hypothesis: 'unknown' },
        decision: 'ask',
        toolCall: null,
        confidence: 0.2,
        gaps: [],
        insufficientInfo: [],
        reasoningSteps: [
          '"Weak in Maths" is a symptom, not a topic — it cannot be searched on.',
          'Distinguishing "cannot start" from "starts and fails" separates a conceptual gap from a procedural one.',
        ],
      }),
      JSON.stringify({
        reply:
          'That points away from the algebra itself. One more question: when she factorises something like x² − 5x + 6, does she get the signs right — the −2 and −3?',
        state: { subject: 'mathematics', level: 'matric', board: 'sindh-board', hypothesis: 'procedural, arithmetic' },
        decision: 'ask',
        toolCall: null,
        confidence: 0.55,
        gaps: [{ topicId: FACTORISATION, confidence: 0.5, rationale: 'Errors appear during algebraic work', isRootGap: false }],
        insufficientInfo: [],
        reasoningSteps: [
          'She can begin, so the method is known — the failure is downstream of understanding.',
          'Sign errors in factorisation are the classic signature of weak signed-number arithmetic.',
        ],
      }),
      JSON.stringify({
        reply:
          'Then the gap is not quadratics. It is signed-number arithmetic, which sits three topics upstream and is assumed by everything after it. A tutor who drills quadratics will not fix this. I have found three verified tutors who work on prerequisite gaps rather than syllabus order.',
        state: { subject: 'mathematics', level: 'matric', board: 'sindh-board', hypothesis: 'confirmed root gap' },
        decision: 'search',
        toolCall: { subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board', topicIds: [INTEGERS, FACTORISATION] },
        confidence: 0.88,
        gaps: [
          { topicId: INTEGERS, confidence: 0.88, rationale: 'Confirmed: she writes +2 and +3 where the factors are −2 and −3, and does not see it', isRootGap: true },
          { topicId: FACTORISATION, confidence: 0.7, rationale: 'Fails as a consequence of the arithmetic, not on its own', isRootGap: false },
          { topicId: QUADRATICS, confidence: 0.4, rationale: 'The presenting symptom. Downstream of both.', isRootGap: false },
        ],
        insufficientInfo: [],
        reasoningSteps: [
          'Sign errors confirmed on a factorisation the parent recognised immediately.',
          'Walking the prerequisite graph upward from quadratics: factorisation → signed-number arithmetic.',
          'Searching on the root gap, not the symptom.',
        ],
      }),
    ],
    diagnostic: {
      subjectId: 'mathematics',
      gapMap: {
        gaps: [
          { topicId: INTEGERS, confidence: 0.88, rationale: 'Confirmed by a worked example the parent recognised', isRootGap: true },
          { topicId: FACTORISATION, confidence: 0.7, rationale: 'Fails as a consequence of the arithmetic', isRootGap: false },
          { topicId: QUADRATICS, confidence: 0.4, rationale: 'The presenting symptom', isRootGap: false },
        ],
        confidence: 0.88,
      },
      // The shortlist is what survived hard-constraint filtering **in code**
      // after the tool call (FR-10.12, FR-16.4). The model proposed; code decided.
      matchedSlugs: ['ayesha-siddiqui', 'fatima-noor', 'rabia-khan'],
    },
    exhibit: {
      note: 'The shortlist below was filtered in application code after the model responded. The model never sees the gender, budget or area constraints — `shared/ai-contract.ts` gives its search tool call no field to express them in.',
      prerequisiteChain: [INTEGERS, FACTORISATION, QUADRATICS],
    },
  },

  /* =====================================================================
   * Scenario B — FR-15.3
   * ================================================================== */
  {
    key: 'review-analysis',
    title: 'Five stars, and the text says otherwise',
    summary:
      'A five-star review whose words describe repeated lateness is flagged as contradictory and the disagreement is shown. A review reading only "Best teacher ever" is down-weighted — never hidden.',
    requirement: 'FR-15.3',
    type: 'diagnostic_intake',
    status: 'concluded',
    goal: 'Review intelligence over two contrasting reviews',
    model: 'gemini-2.0-flash',
    promptVersion: 'review-intelligence.v1',
    transcript: [
      {
        role: 'parent',
        text: 'Very good teacher, my son improved a lot in Physics. Only thing is she was late most days, usually twenty or thirty minutes, and twice she did not come at all and we found out when I called. But the teaching itself is very good so five stars.',
      },
      {
        role: 'agent',
        text: 'Rating and text disagree. The reviewer awarded five stars while describing lateness on most days and two absences without notice. Punctuality scored 1 of 5 and consistency 1 of 5, each quoted from the reviewer\'s own words. The contradiction is surfaced publicly — the stars alone would mislead a family reading quickly. The rating is not altered.',
      },
      { role: 'parent', text: 'Best teacher ever' },
      {
        role: 'agent',
        text: 'Seven of eight dimensions carry no evidence. Detail level 0.08. Flagged generic and weighted at 0.35 in ranking. It stays visible: the flag changes a weight, not visibility.',
      },
    ],
    replayScript: [
      JSON.stringify({
        reply:
          'Rating and text disagree. The reviewer awarded five stars while describing lateness on most days and two absences without notice. Punctuality scored 1 of 5 and consistency 1 of 5, each quoted from the reviewer\'s own words. The contradiction is surfaced publicly — the stars alone would mislead a family reading quickly. The rating is not altered.',
        state: { analysed: 'contradiction' },
        decision: 'conclude',
        toolCall: null,
        confidence: 0.9,
        gaps: [],
        insufficientInfo: [],
        reasoningSteps: [
          'Extracted per-dimension evidence by quoting the review rather than summarising it.',
          'Punctuality and consistency contradict a five-star rating.',
          'FR-9.7: surface the disagreement publicly. FR-9.6 down-weighting does not apply — this review is highly specific.',
        ],
      }),
      JSON.stringify({
        reply:
          'Seven of eight dimensions carry no evidence. Detail level 0.08. Flagged generic and weighted at 0.35 in ranking. It stays visible: the flag changes a weight, not visibility.',
        state: { analysed: 'generic' },
        decision: 'conclude',
        toolCall: null,
        confidence: 0.95,
        gaps: [],
        insufficientInfo: [],
        reasoningSteps: [
          'No dimension carries quotable evidence except an unsupported superlative.',
          'FR-9.6: down-weight, never hide and never delete.',
        ],
      }),
    ],
    exhibit: {
      contradictionReview: { rating: 5, punctuality: 1, consistency: 1, credibilityWeight: 1, contradictionFlag: true },
      genericReview: { rating: 5, detailLevel: 0.08, credibilityWeight: 0.35, genericFlag: true, hidden: false },
      note: 'Both reviews remain publicly visible. Neither rating was changed by the platform.',
    },
  },

  /* =====================================================================
   * Scenario C — FR-15.4
   * ================================================================== */
  {
    key: 'competency-chemistry',
    title: 'Passes Organic, fails Thermodynamics',
    summary:
      'A tutor claiming FSc Chemistry is assessed per topic. The badge is issued for Organic Chemistry and withheld for Thermodynamics — the failed topic only, never the whole subject.',
    requirement: 'FR-15.4',
    type: 'competency_verification',
    status: 'concluded',
    goal: 'Competency verification: FSc Chemistry',
    model: 'gemini-2.0-flash',
    promptVersion: 'competency-verification.v1',
    transcript: [
      {
        role: 'tutor',
        text: 'A student says a tertiary alkyl halide reacts faster than a primary one with water. Is that right, and how would you explain it to a Matric student?',
      },
      {
        role: 'tutor',
        text: 'Yes, for this reaction. Water is a weak nucleophile so it goes by SN1, and SN1 depends on how stable the carbocation is. Tertiary gives a tertiary carbocation, which is the most stable of the three because the three alkyl groups push electron density in. I would tell a student: the reaction has to make a positive carbon first, and a tertiary carbon has three neighbours helping to hold that charge, so it forms most easily. If we changed to a strong nucleophile the order would flip, and that catches people out.',
      },
      {
        role: 'tutor',
        text: 'A gas expands and does work on its surroundings with no heat exchanged. What happens to the internal energy?',
      },
      {
        role: 'tutor',
        text: 'The internal energy stays the same because energy is conserved. The gas does work but the energy comes back from the surroundings so ΔU is zero.',
      },
    ],
    replayScript: [
      JSON.stringify({
        items: [
          {
            id: 'organic-1',
            question: 'A student says a tertiary alkyl halide reacts faster than a primary one with water. Is that right, and how would you explain it to a Matric student?',
            expectedPoints: [
              'Correct for a weak nucleophile: SN1 dominates',
              'Rate depends on carbocation stability',
              'Tertiary carbocation is most stable through alkyl electron donation',
              'The order reverses for a strong nucleophile under SN2',
            ],
          },
          {
            id: 'thermo-1',
            question: 'A gas expands and does work on its surroundings with no heat exchanged. What happens to the internal energy?',
            expectedPoints: [
              'Adiabatic: q = 0',
              'ΔU = q − w reduces to ΔU = −w',
              'Internal energy falls',
              'Temperature falls with it',
            ],
          },
        ],
      }),
      JSON.stringify({
        grades: [
          {
            itemId: 'organic-1',
            correct: true,
            explanationQuality: 'reasoned',
            pitchedForStudent: true,
            note: 'Identified SN1 from the weak nucleophile without being prompted, gave carbocation stability as the mechanism, and volunteered that a strong nucleophile reverses the order. The student-facing explanation avoided the term carbocation and used "a positive carbon with three neighbours helping hold the charge".',
          },
          {
            itemId: 'thermo-1',
            correct: false,
            explanationQuality: 'asserted',
            pitchedForStudent: false,
            note: 'Stated ΔU is zero. With q = 0, ΔU = −w, so internal energy falls and the gas cools. The answer invokes conservation of energy correctly but applies it to the wrong system boundary — energy does not "come back from the surroundings" in an adiabatic expansion.',
          },
        ],
        reasoning:
          'Organic Chemistry is answered at the level claimed, with the reasoning shown and pitched for a student. Thermodynamics is not: the first law is misapplied at the system boundary, which is the specific error that produces wrong answers throughout the topic.',
      }),
    ],
    exhibit: {
      // The model classified. `shared/competency.ts` computed the mark, in code,
      // from those classifications (§7.2, FR-11.5).
      outcome: [
        { topic: 'Organic Chemistry', verdict: 'passed', badge: 'Passed assessment: Organic Chemistry' },
        { topic: 'Thermodynamics', verdict: 'failed', badge: null },
      ],
      note: 'Per topic, never per subject (FR-11.6). The tutor keeps the claim on Thermodynamics and may appeal or re-sit after the cooling period — an automated verdict affecting a livelihood is never final (SEC-18).',
    },
  },

  /* =====================================================================
   * Scenario D — FR-15.5
   * ================================================================== */
  {
    key: 'ranking-explanation',
    title: 'Why this tutor ranked here',
    summary:
      'A deterministic score, its raw signal table, and the narration generated from it. The narrator may introduce no figure that is not in the breakdown it was handed.',
    requirement: 'FR-15.5',
    type: 'diagnostic_intake',
    status: 'concluded',
    goal: 'Ranking narration for a computed breakdown',
    model: 'gemini-2.0-flash',
    promptVersion: 'ranking-explanation.v1',
    transcript: [
      { role: 'parent', text: 'Why is Ayesha Siddiqui ranked first for this search?' },
      {
        role: 'agent',
        text: 'She matches on every hard constraint you set — female, home tuition, Clifton, Matric Mathematics on the Sindh Board — so she is in the result set at all. Above that, she has the strongest verified-topic coverage of the matching tutors for the specific gap in your search, her reviews are detailed rather than brief, and her confirmation rate is high. Her rate sits in the middle of the range for Clifton, so price neither lifted nor lowered her position.',
      },
    ],
    replayScript: [
      JSON.stringify({
        narration:
          'She matches on every hard constraint you set — female, home tuition, Clifton, Matric Mathematics on the Sindh Board — so she is in the result set at all. Above that, she has the strongest verified-topic coverage of the matching tutors for the specific gap in your search, her reviews are detailed rather than brief, and her confirmation rate is high. Her rate sits in the middle of the range for Clifton, so price neither lifted nor lowered her position.',
      }),
    ],
    exhibit: {
      breakdown: {
        topicCoverage: 0.94,
        reviewCredibility: 0.88,
        reliability: 0.91,
        ratePosition: 'median for area',
        verificationRecency: 0.8,
      },
      note: 'Every figure the narrator may mention comes from this table, which was computed by `shared/ranking.ts` from materialised columns. A narration that introduces a number not present here is discarded and the raw breakdown is shown instead (FR-22.4).',
    },
  },

  /* =====================================================================
   * Scenario E — FR-15.6
   * ================================================================== */
  {
    key: 'female-home-karachi',
    title: 'The constraint is enforced, not ranked',
    summary:
      'A female-only home tuition search in Clifton. Non-conforming tutors are absent from the result set entirely — not ranked lower, not greyed out, not flagged.',
    requirement: 'FR-15.6',
    type: 'diagnostic_intake',
    status: 'concluded',
    goal: 'Female-only home tuition in Clifton, Matric Mathematics',
    model: 'none',
    promptVersion: 'none',
    transcript: [
      { role: 'parent', text: 'I need a female tutor who will come to our home in Clifton for Matric Maths.' },
      {
        role: 'agent',
        text: 'This search makes no model call at all. Gender is applied as a SQL predicate before ranking begins, so a male tutor is not in the result set to be ranked. Running the same search with the preference removed returns a larger list that includes them — that difference is the control working.',
      },
    ],
    // No model was involved, so there is nothing to replay. The scenario is a
    // search, and the search path makes no AI call by design (§2.8).
    replayScript: [],
    exhibit: {
      query: { genderPreference: 'female_only', mode: 'home', areaId: 'karachi-clifton', subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board' },
      note: 'Enforced in the SQL predicate in `server/repositories/search.ts`, before ranking. `shared/ranking.ts` has no gender term and must never acquire one. The test that guards this asserts absence, not ordering — a test checking "female tutors come first" would pass on an implementation that merely showed male tutors last, which is the one thing forbidden (FR-16.3, §2.4).',
      searchPath: 'Indexed SQL against materialised columns. No aggregate computation, no AI call.',
    },
  },
];
