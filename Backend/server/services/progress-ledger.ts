/**
 * The progress ledger — §6.12.
 *
 * Per-student mastery over time, assembled from session notes (FR-12.1) and the
 * verification record of the tutor who wrote each one, with the original
 * diagnostic gap map set against actual coverage (FR-12.3) and a stagnation
 * indicator (FR-12.4).
 *
 * ── Who may read it ────────────────────────────────────────────────────────
 * The owning parent, the adult student managing their own profile, and
 * administrators. Nobody else — not a tutor who taught one session of it, not
 * another parent, not a public surface. `docs/DATA_MODEL.md` records
 * `session_notes` as parties-and-admin, and the ledger is the aggregate of
 * them; it inherits the narrower rule, not the wider one. Authorisation is
 * enforced in `server/routes/progress.ts` against the ownership columns this
 * module's repository returns.
 *
 * ── On §2.8, honestly ──────────────────────────────────────────────────────
 * §2.8 says derived statistics are materialised, never computed in a request,
 * and `server/db/schema/booking.ts` still carries a comment claiming a
 * background job computes the mastery curve. **It does not, and this computes
 * in the request.** That is a deliberate reading of the invariant rather than
 * an oversight, so here is the reasoning:
 *
 *  · §2.8's boundary is *"computing a statistic — a median, a rate, a count over
 *    reviews — belongs in a job"*, and the four tables it names are
 *    `tutor_scores`, `tutor_search_signals`, `tutor_reliability` and
 *    `rate_benchmarks`. All four feed **search and public ranking**, which is
 *    the path NFR-1 budgets at 500 ms across every tutor on the platform.
 *  · This is none of those. It is one family reading one child's own session
 *    notes on an owner-scoped screen. The work is bounded by that child's
 *    booking count, it touches no shared table, it feeds no ranking, and it
 *    makes no AI call.
 *  · Materialising it would make it *worse*: a parent opening the ledger the
 *    evening after a session must see that session. A nightly job would show
 *    them yesterday's, and the page's only value is that it is true.
 *
 * The stale schema comment has been corrected rather than left to contradict
 * this, and `docs/PROGRESS.md` records the decision. If the ledger ever grows a
 * cross-student or platform-wide figure, that figure belongs in a job.
 */

import {
  type DiagnosedGap,
  type GapCoverage,
  type MasteryObservation,
  type TopicMasterySeries,
  buildMasterySeries,
  compareGapMapToCoverage,
  readGapsFromGapMap,
} from '../../shared/progress';
import {
  findStudentProfileForLedger,
  listBookingsForStudent,
  listDiagnosticsForStudent,
  listIdentityVerificationsFor,
  listSessionNotesForBookings,
} from '../repositories/progress';
import type { Executor } from '../repositories/_base';

/** One session note, as the ledger presents it. */
export interface ProgressLedgerEntry {
  bookingId: string;
  tutorId: string;
  subjectId: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  topicsCovered: string[];
  masteryRatings: Record<string, number>;
  /** The tutor's own words, unchanged and never translated (§2.10). */
  note: string | null;
  /**
   * What the platform had checked about the tutor who wrote this — FR-6.5.
   * States the artefacts and nothing beyond them (SEC-6).
   */
  tutorVerification: {
    verifiedOn: string | null;
    artefactsChecked: string[];
  };
}

export interface ProgressLedger {
  studentProfileId: string;
  studentName: string;
  levelId: string | null;
  boardId: string | null;
  /** Every session note, oldest first (FR-12.1). */
  entries: ProgressLedgerEntry[];
  /** Mastery per topic over time (FR-12.2). */
  topics: TopicMasterySeries[];
  /** The diagnosed gaps against what was actually taught (FR-12.3). */
  gapCoverage: GapCoverage[];
  /** Topics with three or more sessions and no increase (FR-12.4). */
  stagnantTopicIds: string[];
  summary: {
    sessionsRecorded: number;
    topicsTaught: number;
    gapsDiagnosed: number;
    gapsAddressed: number;
    /** Present only when a diagnostic exists — otherwise there is nothing to compare. */
    hasDiagnostic: boolean;
  };
}

export async function buildProgressLedger(
  db: Executor,
  studentProfileId: string,
): Promise<ProgressLedger | null> {
  const student = await findStudentProfileForLedger(db, studentProfileId);
  if (!student) return null;

  const bookingRows = await listBookingsForStudent(db, studentProfileId);
  const notes = await listSessionNotesForBookings(
    db,
    bookingRows.map((booking) => booking.id),
  );

  const bookingById = new Map(bookingRows.map((booking) => [booking.id, booking]));
  const verifications = await listIdentityVerificationsFor(
    db,
    [...new Set(notes.map((note) => note.tutorId))],
  );

  const entries: ProgressLedgerEntry[] = [];
  const observations: MasteryObservation[] = [];

  for (const note of notes) {
    const verification = verifications.get(note.tutorId);
    const createdAt = note.createdAt.toISOString();

    entries.push({
      bookingId: note.bookingId,
      tutorId: note.tutorId,
      subjectId: bookingById.get(note.bookingId)?.subjectId ?? null,
      createdAt,
      topicsCovered: note.topicsCovered,
      masteryRatings: note.masteryRatings,
      note: note.note,
      tutorVerification: {
        verifiedOn: verification?.verifiedOn ? verification.verifiedOn.toISOString() : null,
        artefactsChecked: verification?.artefactsChecked ?? [],
      },
    });

    for (const [topicId, rating] of Object.entries(note.masteryRatings)) {
      // A rating outside 1–5 is corruption, not a data point. Skipping it keeps
      // one bad note from distorting a curve the parent is asked to read.
      if (typeof rating !== 'number' || !Number.isFinite(rating)) continue;
      observations.push({ topicId, rating, at: createdAt, bookingId: note.bookingId });
    }
  }

  const topics = buildMasterySeries(observations);
  const gaps = await readDiagnosedGaps(db, studentProfileId);
  const gapCoverage = compareGapMapToCoverage(gaps, topics);

  return {
    studentProfileId: student.id,
    studentName: student.name,
    levelId: student.levelId,
    boardId: student.boardId,
    entries,
    topics,
    gapCoverage,
    stagnantTopicIds: topics.filter((topic) => topic.stagnant).map((topic) => topic.topicId),
    summary: {
      sessionsRecorded: entries.length,
      topicsTaught: topics.length,
      gapsDiagnosed: gaps.length,
      gapsAddressed: gapCoverage.filter((gap) => gap.state === 'addressed').length,
      hasDiagnostic: gaps.length > 0,
    },
  };
}

/**
 * The gaps to compare coverage against — the **most recent** diagnostic per
 * subject.
 *
 * An earlier diagnostic records what was true then. Comparing today's teaching
 * against a superseded gap map would credit the tutor for gaps that were
 * re-diagnosed rather than closed, which is the one way this view could mislead
 * the person relying on it.
 */
async function readDiagnosedGaps(
  db: Executor,
  studentProfileId: string,
): Promise<DiagnosedGap[]> {
  const rows = await listDiagnosticsForStudent(db, studentProfileId);
  if (rows.length === 0) return [];

  // Ordered oldest first by the repository, so the last write per subject wins.
  const latestPerSubject = new Map<string, (typeof rows)[number]>();
  for (const row of rows) latestPerSubject.set(row.subjectId ?? '', row);

  const gaps: DiagnosedGap[] = [];
  const seen = new Set<string>();
  for (const row of latestPerSubject.values()) {
    for (const gap of readGapsFromGapMap(row.gapMap)) {
      if (seen.has(gap.topicId)) continue;
      seen.add(gap.topicId);
      gaps.push(gap);
    }
  }
  return gaps;
}
