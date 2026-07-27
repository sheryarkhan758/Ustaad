/**
 * `tutor_reliability` materialisation — §6.17, SEC-21, NFR-15.
 *
 * Reliability statistics are computed **here, in a job**, and read by search
 * from a materialised row. A search request never counts a booking.
 *
 * ── The exclusion that matters (SEC-21, FR-29.14) ──────────────────────────
 * A decline made under a declared safety constraint is **removed from the
 * confirmation-rate denominator entirely** — it counts neither as a decline nor
 * as a request.
 *
 * The platform's primary use case sends a woman alone to an address she has not
 * seen. She is entitled to restrict herself to female students, to require a
 * guardian present, and to refuse an area. If exercising any of those lowered
 * her public confirmation rate, the statistic would become a standing pressure
 * to accept engagements she judged unsafe — and the platform would have built
 * the incentive it exists to remove.
 *
 * `safetyDeclinesExcluded` and `bookingBasis` are both stored, so the published
 * rate can be reconstructed from stored numbers and the exclusion audited
 * rather than trusted.
 */

import { eq } from 'drizzle-orm';

import { countsTowardConfirmationRate } from '../../shared/booking-status';
import { fromDbBool, nowIso } from '../../shared/db-values';
import { bookings } from '../db/schema/booking';
import { tutorReliability } from '../db/schema/derived';
import { tutorProfiles } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';

export interface ReliabilityStats {
  tutorId: string;
  medianResponseMins: number | null;
  confirmationRate: number | null;
  onTimeRate: number | null;
  completionRate: number | null;
  cancellationRate: number | null;
  completedCount: number;
  noShowCount: number;
  safetyDeclinesExcluded: number;
  bookingBasis: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Pure, so the SEC-21 exclusion can be tested without a database. */
export function computeReliability(
  tutorId: string,
  rows: ReadonlyArray<{
    status: string;
    declineUnderSafetyConstraint: number;
    requestedAt: string;
    respondedAt: string | null;
    slotStart: string | null;
    completedAt: string | null;
  }>,
): ReliabilityStats {
  let confirmed = 0;
  let completed = 0;
  let noShow = 0;
  let cancelled = 0;
  let basis = 0;
  let safetyDeclines = 0;
  let attended = 0;
  let onTime = 0;

  const responseMinutes: number[] = [];

  for (const row of rows) {
    const status = row.status as Parameters<typeof countsTowardConfirmationRate>[0]['status'];
    const safetyDecline = fromDbBool(row.declineUnderSafetyConstraint);

    if (status === 'declined' && safetyDecline) {
      safetyDeclines += 1;
      // Counted for audit, then removed from every rate below. Not a decline,
      // not a request — absent from the denominator (SEC-21).
      continue;
    }

    if (countsTowardConfirmationRate({ status, declineUnderSafetyConstraint: safetyDecline })) {
      basis += 1;
    }

    if (status === 'confirmed' || status === 'in_progress' || status === 'completed') confirmed += 1;
    if (status === 'completed') completed += 1;
    if (status === 'no_show') noShow += 1;
    if (status === 'cancelled') cancelled += 1;

    if (row.respondedAt) {
      const minutes = Math.round(
        (new Date(row.respondedAt).getTime() - new Date(row.requestedAt).getTime()) / 60_000,
      );
      if (Number.isFinite(minutes) && minutes >= 0) responseMinutes.push(minutes);
    }

    // On time: the session happened, and it was not recorded as a no-show.
    if (status === 'completed' || status === 'no_show') {
      attended += 1;
      if (status === 'completed') onTime += 1;
    }
  }

  return {
    tutorId,
    medianResponseMins: median(responseMinutes),
    confirmationRate: basis > 0 ? confirmed / basis : null,
    onTimeRate: attended > 0 ? onTime / attended : null,
    completionRate: confirmed > 0 ? completed / confirmed : null,
    cancellationRate: basis > 0 ? cancelled / basis : null,
    completedCount: completed,
    noShowCount: noShow,
    safetyDeclinesExcluded: safetyDeclines,
    bookingBasis: basis,
  };
}

export interface JobResult {
  written: number;
  tookMs: number;
}

export async function recomputeTutorReliability(db: Executor): Promise<JobResult> {
  const startedAt = performance.now();

  const tutors = await db.select({ id: tutorProfiles.id }).from(tutorProfiles);
  const allBookings = await db
    .select({
      tutorId: bookings.tutorId,
      status: bookings.status,
      declineUnderSafetyConstraint: bookings.declineUnderSafetyConstraint,
      requestedAt: bookings.requestedAt,
      respondedAt: bookings.respondedAt,
      slotStart: bookings.slotStart,
      completedAt: bookings.completedAt,
    })
    .from(bookings);

  const byTutor = new Map<string, typeof allBookings>();
  for (const row of allBookings) {
    const list = byTutor.get(row.tutorId);
    if (list) list.push(row);
    else byTutor.set(row.tutorId, [row]);
  }

  let written = 0;

  for (const tutor of tutors) {
    const stats = computeReliability(tutor.id, byTutor.get(tutor.id) ?? []);

    const values = {
      medianResponseMins: stats.medianResponseMins,
      confirmationRate: stats.confirmationRate,
      onTimeRate: stats.onTimeRate,
      completionRate: stats.completionRate,
      cancellationRate: stats.cancellationRate,
      completedCount: stats.completedCount,
      noShowCount: stats.noShowCount,
      safetyDeclinesExcluded: stats.safetyDeclinesExcluded,
      bookingBasis: stats.bookingBasis,
      computedAt: nowIso(),
    };

    const existing = await db
      .select({ tutorId: tutorReliability.tutorId })
      .from(tutorReliability)
      .where(eq(tutorReliability.tutorId, tutor.id))
      .limit(1);

    if (existing[0]) {
      await db.update(tutorReliability).set(values).where(eq(tutorReliability.tutorId, tutor.id));
    } else {
      await db.insert(tutorReliability).values({ tutorId: tutor.id, ...values });
    }
    written += 1;
  }

  return { written, tookMs: Math.round(performance.now() - startedAt) };
}
