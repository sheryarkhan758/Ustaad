/**
 * The availability calendar — §6.8, FR-8.3.
 *
 * ── Conflicts are unselectable, not rejected ───────────────────────────────
 * `GET /api/bookings/slots` returns the tutor's weekly template **minus every
 * live booking**. A taken slot is therefore not in the response at all, and
 * this component renders exactly what it was given. There is no disabled
 * "already booked" tile, because there is no data behind one.
 *
 * That is the difference the task asks for. A calendar that shows all the
 * tutor's hours and refuses the taken ones on submit teaches a family that the
 * interface lies to them — and the refusal always arrives after they have
 * chosen a time, told a child, and cleared an afternoon. The server is still
 * the enforcement (a unique index, not a check-then-write, so two families
 * racing for the last Tuesday resolve correctly); this is about not asking
 * somebody to make a choice that was never available.
 *
 * A slot that vanishes between load and submit still produces a 409
 * `slot_taken`. The booking page says so plainly and refetches, rather than
 * pretending it did not happen.
 *
 * ── Times are the tutor's, in her timezone ─────────────────────────────────
 * The server sends `localStart`/`localEnd` as `HH:MM` in Pakistan time —
 * literally what the tutor wrote in her availability grid — alongside the UTC
 * instant that gets submitted. The interface shows her words; the request
 * carries the instant. Reformatting the instant into local time in the browser
 * would put a device's timezone between a tutor and a family who live in the
 * same city.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, EmptyState } from '../ui/Card';
import { Clock } from '../ui/Icon';
import { useFormat } from '../../lib/format';

/** `2026-07-29` → the weekday and day, in the reading language. */
function useDayLabel() {
  const fmt = useFormat();
  return (isoDate) => fmt.date(`${isoDate}T00:00:00.000Z`, { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Group the flat slot list by date.
 *
 * The server already returns them in order, so this preserves insertion order
 * rather than sorting — re-sorting would silently disagree with the server if
 * its ordering ever changed, and the server's is the one that matters.
 */
function byDate(slots) {
  const days = new Map();
  for (const slot of slots) {
    if (!days.has(slot.date)) days.set(slot.date, []);
    days.get(slot.date).push(slot);
  }
  return [...days.entries()];
}

export function SlotCalendar({ slots = [], value = null, onChange, mode = null }) {
  const { t } = useTranslation(['booking', 'common']);
  const dayLabel = useDayLabel();

  // A mode filter narrows what is offered. The server can filter too; doing it
  // here as well keeps the grid honest when a family switches mode without a
  // refetch having landed yet.
  const visible = useMemo(
    () => (mode ? slots.filter((slot) => slot.mode === mode) : slots),
    [slots, mode],
  );

  const days = useMemo(() => byDate(visible), [visible]);

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<Clock />}
        title={t('slots.emptyTitle')}
        description={t('slots.emptyBody')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/*
        A radiogroup, not a list of buttons: choosing a time is choosing one of
        a set, and arrow-key navigation between times is what a keyboard user
        expects from that.
      */}
      <div role="radiogroup" aria-label={t('slots.legend')} className="space-y-4">
        {days.map(([date, daySlots]) => (
          <div key={date}>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {dayLabel(date)}
            </h3>

            <div className="mt-2 flex flex-wrap gap-2">
              {daySlots.map((slot) => {
                const selected = value?.startsAt === slot.startsAt;

                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange?.(slot)}
                    className={[
                      'min-h-tap rounded-control border px-3 text-small tnum transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris-deep',
                      selected
                        ? 'border-verdigris-deep bg-verdigris-deep text-white'
                        : 'border-slate-line bg-white text-ink hover:border-verdigris-deep',
                    ].join(' ')}
                  >
                    {/* The tutor's own words for the time. See the header. */}
                    {slot.localStart}–{slot.localEnd}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {value ? (
        <p className="text-small text-ink" aria-live="polite">
          {t('slots.chosen', {
            day: dayLabel(value.date),
            start: value.localStart,
            end: value.localEnd,
          })}{' '}
          <Badge tone="neutral">{t(`common:mode.${value.mode}`)}</Badge>
        </p>
      ) : null}

      {/*
        Said once, under the grid. Without it, a family who knows the tutor
        teaches on Mondays and sees no Monday here concludes the site is broken
        rather than that somebody else booked it.
      */}
      <p className="text-caption text-slate">{t('slots.onlyFreeNote')}</p>
    </div>
  );
}
