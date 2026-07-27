/**
 * Weekly availability — §6.8, FR-8.1.
 *
 * ── A grid, not twenty dropdowns ───────────────────────────────────────────
 * Availability is a shape: Monday and Wednesday evenings, Saturday morning.
 * Entering that as seven rows of start-and-end selects makes the tutor hold the
 * shape in her head while the form asks her about it one field at a time — and
 * she cannot see what she has built until she has finished building it.
 *
 * So: a grid of weekday × hour band, and she taps the blocks she is free.
 *
 * ── Bands, not free times ──────────────────────────────────────────────────
 * Two-hour bands from 08:00 to 22:00. Not because arbitrary times are hard, but
 * because tuition is not scheduled to the minute — "Monday evening" is the real
 * unit, and a picker offering 16:47 invites precision the arrangement does not
 * have. A tutor who genuinely needs 16:30 can still edit the slot afterwards.
 *
 * ── Mode and area belong to the slot ───────────────────────────────────────
 * A tutor may teach online on a weekday evening and travel on a Saturday
 * morning, and the areas she will reach on a weekday may be fewer. So mode is
 * set per selection rather than once for the whole week.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TEACHING_MODES } from '@shared/rates';

import { Button } from '../ui/Button';
import { Badge, Card, CardBody } from '../ui/Card';
import { Field, Select } from '../ui/Field';
import { Combobox } from '../ui/Combobox';
import { useAreas, useLocalName } from '../../lib/reference';

/** 0 = Sunday, matching the stored `weekday`. */
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** 08:00 → 22:00 in two-hour bands. */
const BANDS = [
  ['08:00', '10:00'],
  ['10:00', '12:00'],
  ['12:00', '14:00'],
  ['14:00', '16:00'],
  ['16:00', '18:00'],
  ['18:00', '20:00'],
  ['20:00', '22:00'],
];

const cellKey = (weekday, start) => `${weekday}|${start}`;

export function AvailabilityGrid({ slots = [], cityId, onChange, disabled = false }) {
  const { t } = useTranslation(['tutor', 'search', 'common']);
  const localName = useLocalName();
  const areas = useAreas(cityId);

  const [mode, setMode] = useState('home');
  const [areaId, setAreaId] = useState(null);

  /** Which cells are already covered, so the grid can render its state. */
  const covered = useMemo(() => {
    const map = new Map();
    for (const slot of slots) map.set(cellKey(slot.weekday, slot.startTime), slot);
    return map;
  }, [slots]);

  const toggle = (weekday, [startTime, endTime]) => {
    if (disabled) return;
    const key = cellKey(weekday, startTime);

    if (covered.has(key)) {
      onChange?.(slots.filter((slot) => cellKey(slot.weekday, slot.startTime) !== key));
      return;
    }

    onChange?.([
      ...slots,
      {
        weekday,
        startTime,
        endTime,
        mode,
        // Only meaningful when she is travelling. An online slot with an area
        // on it would be a claim about where the student is, which is not hers
        // to make.
        areaId: mode === 'home' ? areaId : null,
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label={t('availability.modeForNew')} hint={t('availability.modeHint')}>
            {(props) => (
              <Select {...props} value={mode} onChange={(event) => setMode(event.target.value)}>
                {TEACHING_MODES.map((value) => (
                  <option key={value} value={value}>
                    {t(`search:mode.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {mode === 'home' ? (
            <Field label={t('availability.areaForNew')} hint={t('availability.areaHint')}>
              {(props) => (
                <Combobox
                  {...props}
                  label={t('availability.areaForNew')}
                  value={areaId}
                  onChange={setAreaId}
                  options={areas.data ?? []}
                  renderName={localName}
                  disabled={!cityId}
                />
              )}
            </Field>
          ) : null}
        </CardBody>
      </Card>

      {/*
        The grid. A `<table>` because it genuinely is one — a screen reader
        announces "Monday, 18:00 to 20:00" from the row and column headers with
        no extra ARIA, which a div grid would have to reconstruct by hand.
      */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[36rem] border-collapse text-start">
          <caption className="sr-only">{t('availability.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-2 pe-2 text-caption font-semibold text-slate">
                {t('availability.time')}
              </th>
              {WEEKDAYS.map((weekday) => (
                <th
                  key={weekday}
                  scope="col"
                  className="pb-2 text-center text-caption font-semibold uppercase tracking-wide text-slate"
                >
                  {t(`availability.weekday.${weekday}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BANDS.map((band) => (
              <tr key={band[0]}>
                <th
                  scope="row"
                  className="pe-2 py-1 text-start font-mono text-caption tnum text-slate"
                >
                  {band[0]}
                </th>
                {WEEKDAYS.map((weekday) => {
                  const slot = covered.get(cellKey(weekday, band[0]));
                  const isOn = Boolean(slot);
                  return (
                    <td key={weekday} className="p-0.5">
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={isOn}
                        // The full sentence, because the visual position is
                        // what carries the meaning for a sighted user and a
                        // screen reader has no position.
                        aria-label={t('availability.cellLabel', {
                          weekday: t(`availability.weekday.${weekday}`),
                          start: band[0],
                          end: band[1],
                        })}
                        onClick={() => toggle(weekday, band)}
                        className={[
                          'flex h-tap w-full items-center justify-center rounded-control border text-caption transition-colors',
                          isOn
                            ? 'border-verdigris bg-verdigris-soft font-semibold text-verdigris-deep'
                            : 'border-slate-line bg-white text-slate hover:border-slate hover:bg-paper',
                          disabled ? 'cursor-not-allowed opacity-60' : '',
                        ].join(' ')}
                      >
                        {isOn ? t(`search:mode.${slot.mode}`) : '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-caption text-slate">
        {slots.length === 0
          ? t('availability.emptyHint')
          : t('availability.count', { count: slots.length })}
      </p>

      {slots.some((slot) => slot.areaId) ? (
        <div className="flex flex-wrap gap-1.5">
          {[...new Set(slots.map((slot) => slot.areaId).filter(Boolean))].map((id) => {
            const area = (areas.data ?? []).find((row) => row.id === id);
            const shown = area ? localName(area) : { text: id, lang: undefined };
            return (
              <Badge key={id} tone="info">
                <span lang={shown.lang}>{shown.text}</span>
              </Badge>
            );
          })}
        </div>
      ) : null}

      {slots.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange?.([])} disabled={disabled}>
          {t('availability.clearAll')}
        </Button>
      ) : null}
    </div>
  );
}
