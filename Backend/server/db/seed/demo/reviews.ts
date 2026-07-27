/**
 * Demonstration reviews — §6.9, and Scenario B in FR-15.3.
 *
 * The point of this file is that the **credibility machinery has to be
 * visible**. A demonstration where every review is four stars and two sentences
 * long proves nothing: down-weighting a generic review and surfacing a
 * contradiction only mean something when you can see the reviews they were
 * applied to sitting next to the ones they were not.
 *
 * So the specificity here genuinely varies, and two rows are written to order
 * against FR-15.3:
 *
 *  · **`five-star-but-late`** — a five-star rating whose text describes repeated
 *    lateness. `contradictionFlag` is set and the disagreement is surfaced
 *    **publicly** (FR-9.7), because a family reading the stars alone would be
 *    misled by the reviewer's own words.
 *  · **`best-teacher-ever`** — the text is "Best teacher ever" and nothing else.
 *    `genericFlag` is set and `credibilityWeight` drops to 0.35. It is
 *    **down-weighted, never hidden and never deleted** (FR-9.6): the flag
 *    changes a weight, not visibility. Deleting a real person's honest if
 *    useless opinion would be a different product.
 *
 * And one row exists for the administrator queue:
 *
 *  · **`safety-concern`** — routes privately to the administrator queue, is
 *    never displayed publicly, and never triggers an automatic notification to
 *    the tutor (FR-9.8, SEC-9). The reason is held on the analysis and is read
 *    only from that queue.
 *
 * The eight dimensions are the ones `shared/review-analysis.ts` derives — see
 * the spec-gap note at the top of `docs/PROGRESS.md`.
 *
 * Every review below is invented. No real person wrote any of this.
 */

export interface DemoReviewSpec {
  /** Key into `DEMO_BOOKING_KEYS`. A review requires a completed booking (SEC-5). */
  bookingKey: string;
  rating: number;
  /** Any script, stored byte for byte, never translated (§2.10). */
  text: string;
  daysAgo: number;
  /** Per-dimension score with the evidence quoted from the review itself. */
  dimensions: Record<string, { score: number; evidence: string | null }>;
  topicsMentioned: string[];
  /** Mean specificity across the dimensions the reviewer actually addressed. */
  detailLevel: number;
  completedSessions: number;
  /** Computed by deterministic code, never by the model (§2.9). */
  credibilityWeight: number;
  generic: boolean;
  contradiction: boolean;
  safetyConcern: boolean;
  safetyConcernReason?: string;
}

const NO_EVIDENCE = { score: 0, evidence: null };

export const DEMO_REVIEWS: DemoReviewSpec[] = [
  /* ---- Highly specific, high credibility ---------------------------- */
  {
    bookingKey: 'completed-monthly',
    rating: 5,
    text:
      'Ayesha started by testing my daughter on things from class six, which I did not expect for a Matric tutor. It turned out she could not handle negative numbers reliably, and that was why quadratics made no sense. Four months later she is solving the standard forms on her own. Punctual every session — twice she messaged ahead when traffic on Shahra-e-Faisal was bad and still arrived within ten minutes. The pace was right for my daughter, not fast, but she covered the syllabus.',
    daysAgo: 5,
    dimensions: {
      punctuality: { score: 5, evidence: 'Punctual every session — twice she messaged ahead when traffic was bad' },
      teachingQuality: { score: 5, evidence: 'started by testing my daughter on things from class six' },
      syllabusCommand: { score: 5, evidence: 'she covered the syllabus' },
      confidenceChange: { score: 5, evidence: 'she is solving the standard forms on her own' },
      communication: { score: 5, evidence: 'she messaged ahead when traffic was bad' },
      pace: { score: 4, evidence: 'The pace was right for my daughter, not fast' },
      consistency: { score: 5, evidence: 'Four months later' },
      valueForMoney: NO_EVIDENCE,
    },
    topicsMentioned: ['math-matric-sindh-quadratic-equations'],
    detailLevel: 0.92,
    completedSessions: 48,
    credibilityWeight: 1,
    generic: false,
    contradiction: false,
    safetyConcern: false,
  },

  /* ---- FR-15.3, Scenario B, first half: five stars, describes lateness */
  {
    bookingKey: 'completed-monthly-2',
    rating: 5,
    text:
      'Very good teacher, my son improved a lot in Physics. Only thing is she was late most days, usually twenty or thirty minutes, and twice she did not come at all and we found out when I called. But the teaching itself is very good so five stars.',
    daysAgo: 8,
    dimensions: {
      punctuality: { score: 1, evidence: 'she was late most days, usually twenty or thirty minutes, and twice she did not come at all' },
      teachingQuality: { score: 5, evidence: 'the teaching itself is very good' },
      syllabusCommand: { score: 4, evidence: 'my son improved a lot in Physics' },
      confidenceChange: { score: 4, evidence: 'my son improved a lot' },
      communication: { score: 2, evidence: 'we found out when I called' },
      pace: NO_EVIDENCE,
      consistency: { score: 1, evidence: 'twice she did not come at all' },
      valueForMoney: NO_EVIDENCE,
    },
    topicsMentioned: [],
    detailLevel: 0.71,
    completedSessions: 36,
    // The rating is not adjusted — the reviewer's five stars stay five stars.
    // What changes is that the disagreement is shown (FR-9.7).
    credibilityWeight: 1,
    generic: false,
    contradiction: true,
    safetyConcern: false,
  },

  /* ---- FR-15.3, Scenario B, second half: generic, down-weighted ------ */
  {
    bookingKey: 'completed-trial',
    rating: 5,
    text: 'Best teacher ever',
    daysAgo: 12,
    dimensions: {
      punctuality: NO_EVIDENCE,
      teachingQuality: { score: 5, evidence: 'Best teacher ever' },
      syllabusCommand: NO_EVIDENCE,
      confidenceChange: NO_EVIDENCE,
      communication: NO_EVIDENCE,
      pace: NO_EVIDENCE,
      consistency: NO_EVIDENCE,
      valueForMoney: NO_EVIDENCE,
    },
    topicsMentioned: [],
    detailLevel: 0.08,
    completedSessions: 1,
    // Down-weighted, never hidden and never deleted (FR-9.6).
    credibilityWeight: 0.35,
    generic: true,
    contradiction: false,
    safetyConcern: false,
  },

  /* ---- Middling, Roman Urdu, moderate specificity -------------------- */
  {
    bookingKey: 'completed-single',
    rating: 3,
    text:
      'Session theek tha. Essay structure par kaam karaya jo helpful tha, lekin ek hour mein sirf introduction cover hua. Agli baar shayad zyada time chahiye. Waqt par aayin thi.',
    daysAgo: 15,
    dimensions: {
      punctuality: { score: 5, evidence: 'Waqt par aayin thi' },
      teachingQuality: { score: 4, evidence: 'Essay structure par kaam karaya jo helpful tha' },
      syllabusCommand: NO_EVIDENCE,
      confidenceChange: NO_EVIDENCE,
      communication: NO_EVIDENCE,
      pace: { score: 2, evidence: 'ek hour mein sirf introduction cover hua' },
      consistency: NO_EVIDENCE,
      valueForMoney: { score: 3, evidence: 'Agli baar shayad zyada time chahiye' },
    },
    topicsMentioned: [],
    detailLevel: 0.55,
    completedSessions: 1,
    credibilityWeight: 0.8,
    generic: false,
    contradiction: false,
    safetyConcern: false,
  },

  /* ---- The safety concern, sitting in the administrator queue --------- */
  {
    bookingKey: 'completed-safety-review',
    rating: 2,
    text:
      'I asked for the sessions to be in the front room where I could see them and she kept moving to the back room with my son and closing the door. I raised it twice. I have ended the arrangement.',
    daysAgo: 3,
    dimensions: {
      punctuality: NO_EVIDENCE,
      teachingQuality: NO_EVIDENCE,
      syllabusCommand: NO_EVIDENCE,
      confidenceChange: NO_EVIDENCE,
      communication: { score: 1, evidence: 'I raised it twice' },
      pace: NO_EVIDENCE,
      consistency: NO_EVIDENCE,
      valueForMoney: NO_EVIDENCE,
    },
    topicsMentioned: [],
    detailLevel: 0.6,
    completedSessions: 9,
    credibilityWeight: 1,
    generic: false,
    contradiction: false,
    // Routes privately to the administrator queue. Never displayed publicly,
    // never automatically disclosed to the tutor (FR-9.8, SEC-9).
    safetyConcern: true,
    safetyConcernReason:
      'Reviewer describes a guardian-presence condition being repeatedly disregarded, and states they raised it twice before ending the arrangement. Requires an administrator, not an automated response.',
  },
];
