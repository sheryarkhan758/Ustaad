/**
 * Progress-ledger reads — §6.12.
 *
 * Everything the ledger is assembled from, and nothing else: the student
 * profile (for ownership), that student's bookings, the session notes written
 * against them, and the identity-verification record of the tutor who wrote
 * each note.
 *
 * The reads are all scoped to **one student profile**. There is no query here
 * that returns notes across students, or mastery across the platform — a ledger
 * is one family's record of one child, and a function that could return two
 * families' is a function somebody eventually calls with the wrong argument.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { fromDbJson, fromDbJsonArray, fromDbTimestamp } from '../../shared/db-values';
import { bookings, sessionNotes } from '../db/schema/booking';
import { diagnostics } from '../db/schema/ai';
import { studentProfiles } from '../db/schema/identity';
import { verificationRecords } from '../db/schema/verification';
import type { Executor } from './_base';

export interface StudentProfileOwnership {
  id: string;
  name: string;
  levelId: string | null;
  boardId: string | null;
  /** The parent account that owns the profile. Null for an adult self-manager. */
  parentUserId: string | null;
  /** Set only for an 18+ student managing their own profile (§2.3). */
  selfUserId: string | null;
}

/**
 * The profile, with just enough to answer "who may read this ledger".
 *
 * Returns the ownership columns and the display name — not the date of birth,
 * not the school, not the notes. A caller deciding an authorisation question
 * should not receive the data the answer gates.
 */
export async function findStudentProfileForLedger(
  db: Executor,
  studentProfileId: string,
): Promise<StudentProfileOwnership | null> {
  const rows = await db
    .select({
      id: studentProfiles.id,
      name: studentProfiles.name,
      levelId: studentProfiles.levelId,
      boardId: studentProfiles.boardId,
      parentUserId: studentProfiles.parentUserId,
      selfUserId: studentProfiles.selfUserId,
    })
    .from(studentProfiles)
    .where(eq(studentProfiles.id, studentProfileId))
    .limit(1);
  return rows[0] ?? null;
}

export interface LedgerBooking {
  id: string;
  tutorId: string;
  subjectId: string | null;
}

export async function listBookingsForStudent(
  db: Executor,
  studentProfileId: string,
): Promise<LedgerBooking[]> {
  const rows = await db
    .select({
      id: bookings.id,
      tutorId: bookings.tutorId,
      subjectId: bookings.subjectId,
    })
    .from(bookings)
    .where(eq(bookings.studentProfileId, studentProfileId));
  return rows;
}

export interface LedgerSessionNote {
  id: string;
  bookingId: string;
  tutorId: string;
  topicsCovered: string[];
  /** `{ [topicId]: 1..5 }`, parsed through `fromDbJson` (§2.1). */
  masteryRatings: Record<string, number>;
  note: string | null;
  createdAt: Date;
}

/**
 * Every session note against a set of bookings, oldest first.
 *
 * One `IN` rather than a query per booking: the ledger charts mastery *over
 * time*, so it needs them all, and N+1 over a long engagement is the difference
 * between one round trip and forty.
 */
export async function listSessionNotesForBookings(
  db: Executor,
  bookingIds: string[],
): Promise<LedgerSessionNote[]> {
  if (bookingIds.length === 0) return [];
  const rows = await db
    .select()
    .from(sessionNotes)
    .where(inArray(sessionNotes.bookingId, bookingIds))
    .orderBy(sessionNotes.createdAt, sessionNotes.id);

  return rows.map((row) => ({
    id: row.id,
    bookingId: row.bookingId,
    tutorId: row.tutorId,
    topicsCovered: fromDbJsonArray(row.topicsCoveredJson),
    masteryRatings: fromDbJson<Record<string, number>>(row.masteryRatingsJson, {}),
    note: row.note,
    createdAt: fromDbTimestamp(row.createdAt),
  }));
}

export interface TutorIdentityVerification {
  tutorId: string;
  verifiedOn: Date | null;
  artefactsChecked: string[];
}

/**
 * The current identity verification for each tutor who wrote a note — FR-12.1's
 * "verification data" half.
 *
 * Only **approved** identity records, and only the artefacts actually checked
 * (FR-6.5). The ledger says "the person who taught this session had their CNIC
 * and degree checked on this date" and never more than that — badge wording
 * that implied a background check would be prohibited here as everywhere else
 * (SEC-6, §2.5).
 */
export async function listIdentityVerificationsFor(
  db: Executor,
  tutorIds: string[],
): Promise<Map<string, TutorIdentityVerification>> {
  const result = new Map<string, TutorIdentityVerification>();
  if (tutorIds.length === 0) return result;

  const rows = await db
    .select({
      tutorId: verificationRecords.tutorId,
      decidedAt: verificationRecords.decidedAt,
      artefactsCheckedJson: verificationRecords.artefactsCheckedJson,
    })
    .from(verificationRecords)
    .where(
      and(
        inArray(verificationRecords.tutorId, tutorIds),
        eq(verificationRecords.track, 'identity'),
        eq(verificationRecords.decision, 'approved'),
      ),
    )
    .orderBy(verificationRecords.decidedAt, verificationRecords.id);

  // Ordered oldest first, so the last write per tutor is the most recent
  // approval — the one the profile shows.
  for (const row of rows) {
    result.set(row.tutorId, {
      tutorId: row.tutorId,
      verifiedOn: fromDbTimestamp(row.decidedAt),
      artefactsChecked: fromDbJsonArray(row.artefactsCheckedJson),
    });
  }
  return result;
}

export interface DiagnosticGapMapRow {
  id: string;
  subjectId: string | null;
  /** The agent's proposal, as stored. Shape is validated by the AI contract. */
  gapMap: unknown;
  createdAt: Date;
}

/**
 * The diagnostic gap maps recorded for this student — FR-12.3's "original
 * diagnostic gap map".
 *
 * Newest first. The ledger uses the most recent one per subject: an earlier
 * diagnostic is a record of what was true then, and comparing today's coverage
 * against a superseded gap map would credit the tutor for gaps that were
 * re-diagnosed rather than closed.
 */
export async function listDiagnosticsForStudent(
  db: Executor,
  studentProfileId: string,
): Promise<DiagnosticGapMapRow[]> {
  const rows = await db
    .select({
      id: diagnostics.id,
      subjectId: diagnostics.subjectId,
      gapMapJson: diagnostics.gapMapJson,
      createdAt: diagnostics.createdAt,
    })
    .from(diagnostics)
    .where(eq(diagnostics.studentProfileId, studentProfileId))
    .orderBy(diagnostics.createdAt, diagnostics.id);

  return rows.map((row) => ({
    id: row.id,
    subjectId: row.subjectId,
    gapMap: fromDbJson<unknown>(row.gapMapJson),
    createdAt: fromDbTimestamp(row.createdAt),
  }));
}
