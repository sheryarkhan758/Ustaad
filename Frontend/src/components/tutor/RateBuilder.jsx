/**
 * The rate table — §6.5, §2.7.
 *
 * ── The hardest form in the product, and why ───────────────────────────────
 * Pakistani tuition is contracted four different ways: a monthly fee for a
 * number of sessions a week, an hourly rate, a per-session fee, and a group
 * rate quoted per head. They are not interchangeable, and a family comparing
 * "PKR 18,000" against "PKR 400" has no idea which is cheaper.
 *
 * So every rate is normalised to a **comparable hourly figure**, and this form
 * shows that figure live, beside the input, as the tutor types.
 *
 * ── The normalisation is computed by the server's own function ─────────────
 * `normaliseHourlyAmount` is imported from `Backend/shared/rates.ts` — the same
 * function the repository calls on write. Reimplementing the arithmetic here
 * would produce a preview that eventually disagrees with the stored value, and
 * the tutor would be shown one number and ranked on another.
 *
 * ── Why the tutor is shown it at all ───────────────────────────────────────
 * She is about to be compared on this figure whether or not she sees it. A form
 * that hides the number a parent will actually judge her on is a form that lets
 * her price herself badly by accident.
 *
 * ── Money is integer paisa, everywhere ─────────────────────────────────────
 * The tutor types rupees. `rupeesToPaisa` converts at this boundary and nothing
 * downstream ever sees a float (§2.1).
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  RATE_TYPES,
  TEACHING_MODES,
  WEEKS_PER_MONTH,
  normaliseHourlyAmount,
  rupeesToPaisa,
} from '@shared/rates';

import { Button } from '../ui/Button';
import { Badge, Card, CardBody, EmptyState, Table, Td, Th } from '../ui/Card';
import { Checkbox, Field, Input, Select } from '../ui/Field';
import { useFormat } from '../../lib/format';

/** Which inputs each rate type actually needs. */
const SHAPE = {
  monthly: { sessionsPerWeek: true, minutesPerSession: true },
  hourly: {},
  single_session: { minutesPerSession: true },
  group_monthly: {
    sessionsPerWeek: true,
    minutesPerSession: true,
    groupSizeMax: true,
    perHeadAmount: true,
  },
};

const EMPTY = {
  rateType: 'monthly',
  mode: 'home',
  amount: '',
  sessionsPerWeek: 3,
  minutesPerSession: 90,
  groupSizeMax: '',
  perHeadAmount: '',
  negotiable: false,
  travelCharge: '',
};

/**
 * The live preview.
 *
 * Returns `null` rather than throwing while the form is incomplete — a tutor
 * halfway through typing has not made a mistake, and an error message that
 * appears on every third keystroke is noise she will learn to ignore.
 */
function previewHourly(draft) {
  const amount = Number(draft.rateType === 'group_monthly' ? draft.perHeadAmount : draft.amount);
  if (!amount || Number.isNaN(amount)) return null;

  try {
    return normaliseHourlyAmount({
      rateType: draft.rateType,
      amount: rupeesToPaisa(Number(draft.amount) || 0),
      sessionsPerWeek: draft.sessionsPerWeek ? Number(draft.sessionsPerWeek) : null,
      minutesPerSession: draft.minutesPerSession ? Number(draft.minutesPerSession) : null,
      perHeadAmount: draft.perHeadAmount ? rupeesToPaisa(Number(draft.perHeadAmount)) : null,
      groupSizeMax: draft.groupSizeMax ? Number(draft.groupSizeMax) : null,
    });
  } catch {
    // The shared function refuses an incomplete rate. That is correct on write
    // and wrong to shout about mid-typing.
    return null;
  }
}

/** The plain-language explainer. Not a tooltip — a tutor should not have to hunt. */
function NormalisationNote() {
  const { t } = useTranslation('tutor');
  const fmt = useFormat();

  // A worked example beats a definition. PKR 18,000 a month, three 90-minute
  // sessions a week, is about PKR 1,385 an hour.
  const example = normaliseHourlyAmount({
    rateType: 'monthly',
    amount: rupeesToPaisa(18000),
    sessionsPerWeek: 3,
    minutesPerSession: 90,
  });

  return (
    <div className="rounded-card border border-verdigris/25 bg-verdigris-soft p-4">
      <p className="text-small font-semibold text-verdigris-deep">{t('rates.whyTitle')}</p>
      <p className="mt-1 text-small text-ink">{t('rates.whyBody')}</p>
      <p className="mt-2 text-small text-ink">
        {t('rates.whyExample', {
          monthly: fmt.paisa(rupeesToPaisa(18000)),
          hourly: fmt.paisa(example),
        })}
      </p>
      <p className="mt-2 text-caption text-slate">
        {t('rates.whyWeeks', { weeks: (Math.round(WEEKS_PER_MONTH * 100) / 100).toFixed(2) })}
      </p>
    </div>
  );
}

export function RateBuilder({ rates = [], onAdd, onRemove, busy = false }) {
  const { t } = useTranslation(['tutor', 'search', 'common']);
  const fmt = useFormat();
  const [draft, setDraft] = useState(EMPTY);

  const shape = SHAPE[draft.rateType] ?? {};
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  const hourly = useMemo(() => previewHourly(draft), [draft]);

  const canAdd = hourly !== null && !busy;

  const submit = (event) => {
    event.preventDefault();
    if (!canAdd) return;

    onAdd?.({
      rateType: draft.rateType,
      mode: draft.mode,
      // Rupees in, paisa out. The boundary is here and nowhere else.
      amount: rupeesToPaisa(Number(draft.amount)),
      sessionsPerWeek: shape.sessionsPerWeek ? Number(draft.sessionsPerWeek) : null,
      minutesPerSession: shape.minutesPerSession ? Number(draft.minutesPerSession) : null,
      groupSizeMax: shape.groupSizeMax ? Number(draft.groupSizeMax) : null,
      perHeadAmount: shape.perHeadAmount ? rupeesToPaisa(Number(draft.perHeadAmount)) : null,
      negotiable: draft.negotiable,
      travelCharge: draft.travelCharge ? rupeesToPaisa(Number(draft.travelCharge)) : 0,
    });
    setDraft(EMPTY);
  };

  return (
    <div className="space-y-5">
      <NormalisationNote />

      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('rates.rateType')} required>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.rateType}
                    onChange={(event) => set({ rateType: event.target.value })}
                  >
                    {RATE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`rates.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t('rates.mode')} required>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.mode}
                    onChange={(event) => set({ mode: event.target.value })}
                  >
                    {TEACHING_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`search:mode.${mode}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                label={
                  draft.rateType === 'group_monthly' ? t('rates.groupTotal') : t('rates.amount')
                }
                required
                hint={t('rates.rupeesOnly')}
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    value={draft.amount}
                    onChange={(event) => set({ amount: event.target.value.replace(/[^\d]/g, '') })}
                    placeholder="18000"
                  />
                )}
              </Field>

              {shape.perHeadAmount ? (
                <Field label={t('rates.perHead')} required hint={t('rates.perHeadHint')}>
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="numeric"
                      value={draft.perHeadAmount}
                      onChange={(event) =>
                        set({ perHeadAmount: event.target.value.replace(/[^\d]/g, '') })
                      }
                      placeholder="7000"
                    />
                  )}
                </Field>
              ) : null}

              {shape.sessionsPerWeek ? (
                <Field label={t('rates.sessionsPerWeek')} required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min="1"
                      max="14"
                      value={draft.sessionsPerWeek}
                      onChange={(event) => set({ sessionsPerWeek: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}

              {shape.minutesPerSession ? (
                <Field label={t('rates.minutesPerSession')} required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min="15"
                      max="300"
                      step="15"
                      value={draft.minutesPerSession}
                      onChange={(event) => set({ minutesPerSession: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}

              {shape.groupSizeMax ? (
                <Field label={t('rates.groupSizeMax')} required>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min="2"
                      max="12"
                      value={draft.groupSizeMax}
                      onChange={(event) => set({ groupSizeMax: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}

              <Field label={t('rates.travel')} hint={t('rates.travelHint')}>
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    value={draft.travelCharge}
                    onChange={(event) =>
                      set({ travelCharge: event.target.value.replace(/[^\d]/g, '') })
                    }
                    placeholder="0"
                  />
                )}
              </Field>
            </div>

            <Checkbox
              label={t('rates.negotiable')}
              hint={t('rates.negotiableHint')}
              checked={draft.negotiable}
              onChange={(event) => set({ negotiable: event.target.checked })}
            />

            {/*
              The live preview. `aria-live="polite"` so a screen-reader user
              hears the figure update rather than discovering it only on submit
              — this is the number she is about to be compared on.
            */}
            <div
              aria-live="polite"
              className="rounded-card border border-slate-line bg-paper p-4"
            >
              {hourly === null ? (
                <p className="text-small text-slate">{t('rates.previewPending')}</p>
              ) : (
                <>
                  <p className="text-caption font-semibold uppercase tracking-wide text-slate">
                    {t('rates.comparableLabel')}
                  </p>
                  <p className="mt-1 font-mono text-title tnum text-ink">
                    {fmt.paisa(hourly)}
                    <span className="ms-2 font-body text-small font-normal text-slate">
                      {t('rates.perHour')}
                    </span>
                  </p>
                  <p className="mt-1 text-caption text-slate">{t('rates.previewNote')}</p>
                </>
              )}
            </div>

            <Button type="submit" variant="primary" disabled={!canAdd} busy={busy}>
              {t('rates.add')}
            </Button>
          </form>
        </CardBody>
      </Card>

      {rates.length === 0 ? (
        <EmptyState title={t('rates.emptyTitle')} description={t('rates.emptyBody')} />
      ) : (
        <Card>
          <CardBody>
            <Table caption={t('rates.title')}>
              <thead>
                <tr>
                  <Th>{t('rates.rateType')}</Th>
                  <Th>{t('rates.mode')}</Th>
                  <Th numeric>{t('rates.amount')}</Th>
                  <Th numeric>{t('rates.comparableShort')}</Th>
                  <Th>{t('common:action.clear')}</Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id ?? `${rate.rateType}-${rate.mode}-${rate.amount}`}>
                    <Td>
                      {t(`rates.${rate.rateType}`)}
                      {rate.negotiable ? (
                        <Badge tone="neutral" className="ms-2">
                          {t('rates.negotiableShort')}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>{t(`search:mode.${rate.mode}`)}</Td>
                    <Td numeric>{fmt.paisa(rate.amount)}</Td>
                    <Td numeric>{fmt.paisa(rate.normalisedHourlyAmount)}</Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRemove?.(rate.id)}
                        aria-label={t('rates.remove')}
                      >
                        {t('rates.remove')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
