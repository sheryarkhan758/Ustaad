/**
 * Slot generation — §6.8, FR-8.1, FR-8.3, FR-8.6.
 *
 * Expands a tutor's weekly availability template across a date range and
 * subtracts every slot already taken by a live booking.
 *
 * ── Time zone ──────────────────────────────────────────────────────────────
 * Availability is authored in Pakistan Standard Time, which is UTC+5 with **no
 * daylight saving** — the one simplification this domain genuinely allows.
 * Slots are stored and compared as ISO-8601 UTC text, and the conversion
 * happens here, once. A `HH:MM` in `tutor_availability` therefore always means
 * the same wall-clock time to the tutor and the family, which is what they will
 * both write down.
 */

import { and, eq, gte, lt } from 'drizzle-orm';

import { bookingSlotReservations } from '../db/schema/booking';
import { tutorAvailability } from '../db/schema/tutor';
import type { Executor } from '../repositories/_base';

/** Pakistan Standard Time. UTC+5, no DST. */
export const PKT_OFFSET_MINUTES = 5 * 60;

export const DEFAULT_SLOT_MINUTES = 60;
/** A range longer than this is a calendar, not a booking flow. */
export const MAX_RANGE_DAYS = 60;

export interface Slot {
  /** ISO-8601 UTC. */
  startsAt: string;
  endsAt: string;
  /** ISO `YYYY-MM-DD` in Pakistan time, for grouping in the interface. */
  date: string;
  /** `HH:MM` in Pakistan time — what the tutor actually wrote. */
  localStart: string;
  localEnd: string;
  mode: 'home' | 'online' | 'own_place';
  areaId: string | null;
}

/** `2026-08-05` + `16:00` in PKT → the UTC instant. */
export function pktToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh!, mm!) - PKT_OFFSET_MINUTES * 60_000);
}

/** The UTC instant, expressed as a Pakistan-time date and `HH:MM`. */
export function utcToPkt(at: Date): { date: string; time: string } {
  const shifted = new Date(at.getTime() + PKT_OFFSET_MINUTES * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  };
}

/** Weekday in Pakistan time, 0 = Sunday. Matches `tutor_availability.weekday`. */
export function pktWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  return next.toISOString().slice(0, 10);
}

const addMinutes = (time: string, minutes: number): string => {
  const [hh, mm] = time.split(':').map(Number);
  const total = hh! * 60 + mm! + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

export interface GenerateSlotsInput {
  tutorId: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  fromDate: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  toDate: string;
  slotMinutes?: number;
  mode?: 'home' | 'online' | 'own_place';
  /** Slots starting before this instant are dropped. Defaults to now. */
  notBefore?: Date;
}

export class SlotRangeError extends Error {
  readonly status = 400;
  readonly code = 'invalid_range';
}

/**
 * Free slots for a tutor across a date range.
 *
 * Two queries regardless of range length: the template, and the live
 * reservations. The expansion is arithmetic over at most 60 days × a handful of
 * template rows, so it adds no round trips.
 */
export async function generateSlots(
  db: Executor,
  input: GenerateSlotsInput,
): Promise<Slot[]> {
  const slotMinutes = input.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const notBefore = input.notBefore ?? new Date();

  if (input.toDate < input.fromDate) {
    throw new SlotRangeError('the range must end on or after it starts');
  }

  const templates = await db
    .select()
    .from(tutorAvailability)
    .where(eq(tutorAvailability.tutorId, input.tutorId));

  if (templates.length === 0) return [];

  // Live bookings only. A cancelled or declined booking has no reservation row,
  // so its slot is free again without anything having to remember that.
  const rangeStart = pktToUtc(input.fromDate, '00:00').toISOString();
  const rangeEnd = pktToUtc(addDaysIso(input.toDate, 1), '00:00').toISOString();

  const taken = await db
    .select({
      slotStart: bookingSlotReservations.slotStart,
      slotEnd: bookingSlotReservations.slotEnd,
    })
    .from(bookingSlotReservations)
    .where(
      and(
        eq(bookingSlotReservations.tutorId, input.tutorId),
        gte(bookingSlotReservations.slotStart, rangeStart),
        lt(bookingSlotReservations.slotStart, rangeEnd),
      ),
    );

  const slots: Slot[] = [];
  let dayCount = 0;

  for (let date = input.fromDate; date <= input.toDate; date = addDaysIso(date, 1)) {
    dayCount += 1;
    if (dayCount > MAX_RANGE_DAYS) {
      throw new SlotRangeError(`a range may cover at most ${MAX_RANGE_DAYS} days`);
    }

    const weekday = pktWeekday(date);

    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      if (input.mode && template.mode !== input.mode) continue;

      for (
        let localStart = template.startTime;
        addMinutes(localStart, slotMinutes) <= template.endTime;
        localStart = addMinutes(localStart, slotMinutes)
      ) {
        const localEnd = addMinutes(localStart, slotMinutes);
        const startsAt = pktToUtc(date, localStart);
        const endsAt = pktToUtc(date, localEnd);

        if (startsAt.getTime() < notBefore.getTime()) continue;

        // Overlap, not equality: a 90-minute booking blocks two 60-minute slots.
        const startIso = startsAt.toISOString();
        const endIso = endsAt.toISOString();
        const clashes = taken.some((t) => t.slotStart < endIso && startIso < t.slotEnd);
        if (clashes) continue;

        slots.push({
          startsAt: startIso,
          endsAt: endIso,
          date,
          localStart,
          localEnd,
          mode: template.mode,
          areaId: template.areaId,
        });
      }
    }
  }

  // Chronological, with a stable order for slots sharing an instant.
  slots.sort((a, b) =>
    a.startsAt === b.startsAt ? a.mode.localeCompare(b.mode) : a.startsAt < b.startsAt ? -1 : 1,
  );

  return slots;
}

/** Whether a specific window is still free. The pre-flight check before insert. */
export async function isSlotFree(
  db: Executor,
  tutorId: string,
  startsAt: string,
  endsAt: string,
): Promise<boolean> {
  const taken = await db
    .select({
      slotStart: bookingSlotReservations.slotStart,
      slotEnd: bookingSlotReservations.slotEnd,
    })
    .from(bookingSlotReservations)
    .where(eq(bookingSlotReservations.tutorId, tutorId));

  return !taken.some((t) => t.slotStart < endsAt && startsAt < t.slotEnd);
}
