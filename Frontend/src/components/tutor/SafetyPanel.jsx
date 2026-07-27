/**
 * Tutor safety constraints — §6.29.2, SEC-19, SEC-21.
 *
 * ── The copy is the feature ────────────────────────────────────────────────
 * This screen's job is to make a woman confident enough to actually use these
 * controls, and the two things standing in the way are both beliefs she has
 * learned from other platforms:
 *
 *  1. *"It is only a preference — they will send me the bookings anyway."*
 *     On most platforms that is true: constraints are displayed on a profile
 *     and the matching ignores them. Here the **system refuses the booking at
 *     request time**. She is told that in those words.
 *
 *  2. *"If I decline, my rating will drop."*
 *     This is the belief that does the damage. A tutor who thinks refusing an
 *     unsafe booking will cost her ranking will accept it. So SEC-21 excludes
 *     declines made under a declared constraint from her confirmation-rate
 *     statistic — and **she is told, on this screen, before she sets one.**
 *
 * A control whose protections are real but unexplained protects nobody, because
 * nobody uses it. The prose here is not decoration around the checkboxes; it is
 * the reason the checkboxes get ticked.
 *
 * ── Why the platform bothers ───────────────────────────────────────────────
 * §11: *"the platform's primary use case sends a woman alone to an address she
 * has not seen."* Most platforms in this market treat safety as something owed
 * to the paying customer. Here the tutor is equally exposed and is treated
 * accordingly — she sets the conditions, the system enforces them, and she is
 * not penalised for holding to them.
 */

import { useTranslation } from 'react-i18next';

import { Badge, Card, CardBody } from '../ui/Card';
import { Checkbox, Field } from '../ui/Field';
import { Combobox } from '../ui/Combobox';
import { Check } from '../ui/Icon';
import { useAreas, useLocalName } from '../../lib/reference';

export function SafetyPanel({ value = {}, onChange, cityId, disabled = false }) {
  const { t } = useTranslation(['tutor', 'common']);
  const localName = useLocalName();
  const areas = useAreas(cityId);

  const set = (patch) => onChange?.({ ...value, ...patch });
  const restricted = value.restrictedAreaIds ?? [];

  const addRestricted = (areaId) => {
    if (!areaId || restricted.includes(areaId)) return;
    set({ restrictedAreaIds: [...restricted, areaId] });
  };

  return (
    <div className="space-y-5">
      {/*
        Stated before the controls, not after. Somebody deciding whether to tick
        a box needs to know what ticking it does before they decide.
      */}
      <div className="rounded-card border-2 border-verdigris/30 bg-verdigris-soft p-4">
        <p className="flex items-center gap-2 font-display text-subtitle text-verdigris-deep">
          <Check />
          {t('safety.enforcedTitle')}
        </p>
        <p className="mt-2 text-small text-ink">{t('safety.enforcedBody')}</p>

        {/* The belief that stops tutors using these controls, addressed head on. */}
        <p className="mt-3 border-t border-verdigris/25 pt-3 text-small font-medium text-ink">
          {t('safety.noPenaltyBody')}
        </p>
      </div>

      <Card>
        <CardBody className="space-y-5">
          <Checkbox
            label={t('safety.femaleOnly')}
            hint={t('safety.femaleOnlyHint')}
            checked={Boolean(value.femaleStudentsOnly)}
            disabled={disabled}
            onChange={(event) => set({ femaleStudentsOnly: event.target.checked })}
          />

          <Checkbox
            label={t('safety.guardian')}
            hint={t('safety.guardianHint')}
            checked={Boolean(value.guardianPresenceRequired)}
            disabled={disabled}
            onChange={(event) => set({ guardianPresenceRequired: event.target.checked })}
          />

          <div>
            <Field label={t('safety.restrictedAreas')} hint={t('safety.restrictedHint')}>
              {(props) => (
                <Combobox
                  {...props}
                  label={t('safety.restrictedAreas')}
                  value={null}
                  onChange={addRestricted}
                  options={(areas.data ?? []).filter((area) => !restricted.includes(area.id))}
                  renderName={localName}
                  disabled={disabled || !cityId}
                  placeholder={t('safety.restrictedPlaceholder')}
                />
              )}
            </Field>

            {restricted.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {restricted.map((areaId) => {
                  const area = (areas.data ?? []).find((row) => row.id === areaId);
                  const shown = area ? localName(area) : { text: areaId, lang: undefined };
                  return (
                    <li key={areaId}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          set({ restrictedAreaIds: restricted.filter((id) => id !== areaId) })
                        }
                        aria-label={t('safety.removeArea', { area: shown.text })}
                        className="flex min-h-tap items-center gap-1.5 rounded-full border border-flag/30 bg-flag-soft px-3 text-small text-flag hover:bg-flag/10"
                      >
                        <span lang={shown.lang}>{shown.text}</span>
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-caption text-slate">{t('safety.noRestrictedAreas')}</p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* A plain summary of what is now in force, in her own terms. */}
      <div className="rounded-card border border-slate-line bg-paper p-4">
        <p className="text-caption font-semibold uppercase tracking-wide text-slate">
          {t('safety.inForceTitle')}
        </p>
        <ul className="mt-2 space-y-1.5">
          {value.femaleStudentsOnly ? (
            <li className="text-small text-ink">
              <Badge tone="info">{t('safety.inForce')}</Badge>{' '}
              {t('safety.summaryFemaleOnly')}
            </li>
          ) : null}
          {value.guardianPresenceRequired ? (
            <li className="text-small text-ink">
              <Badge tone="info">{t('safety.inForce')}</Badge> {t('safety.summaryGuardian')}
            </li>
          ) : null}
          {restricted.length > 0 ? (
            <li className="text-small text-ink">
              <Badge tone="info">{t('safety.inForce')}</Badge>{' '}
              {t('safety.summaryAreas', { count: restricted.length })}
            </li>
          ) : null}
          {!value.femaleStudentsOnly &&
          !value.guardianPresenceRequired &&
          restricted.length === 0 ? (
            <li className="text-small text-slate">{t('safety.noneSet')}</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
