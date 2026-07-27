/**
 * Province → city → area — §6.2.
 *
 * ── Area is the end of the road ────────────────────────────────────────────
 * There is **no map, no pin, no GPS and no coordinate** anywhere in this
 * product (§4.2), and this component is where a user would most expect one. So
 * it deliberately does not imply one: no "use my location" button, no distance
 * in kilometres, no "within 5 km" slider.
 *
 * "Include neighbouring areas" reads a **hand-curated adjacency list**
 * (`area_adjacency`), not a radius — and that is the better answer in a
 * Pakistani city, where two kilometres can be forty minutes and a family's
 * sense of "near" follows roads and neighbourhoods rather than circles. The
 * toggle names the areas it adds, so the user can see exactly what widening the
 * search did.
 *
 * ── The cascade never leaves a stale child ─────────────────────────────────
 * Changing the province clears the city *and* the area. Changing the city
 * clears the area. This is the bug that makes cascading selectors untrustworthy:
 * a form that still holds `karachi-clifton` after the user switched to Punjab
 * submits a Karachi area against a Punjab city, and the server rejects it with
 * an error the person cannot act on.
 */

import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Field } from '../ui/Field';
import { Checkbox } from '../ui/Field';
import { Combobox } from '../ui/Combobox';
import { Badge } from '../ui/Card';
import { useAdjacentAreas, useAreas, useCities, useLocalName, useProvinces } from '../../lib/reference';

/**
 * @param {object} props
 * @param {{provinceId, cityId, areaId, includeAdjacent}} props.value
 * @param {(next: object) => void} props.onChange
 */
export function LocationPicker({ value = {}, onChange, errors = {}, disabled = false }) {
  const { t } = useTranslation(['search', 'common']);
  const localName = useLocalName();

  const provinces = useProvinces();
  const cities = useCities(value.provinceId);
  const areas = useAreas(value.cityId);
  const adjacent = useAdjacentAreas(value.includeAdjacent && value.areaId ? [value.areaId] : []);

  const set = useCallback((patch) => onChange?.({ ...value, ...patch }), [onChange, value]);

  /**
   * Clearing children is done here, in the change handlers, rather than in an
   * effect watching the parent — an effect would also fire when a saved value
   * is loaded into the form and would wipe it.
   */
  const setProvince = useCallback(
    (provinceId) => set({ provinceId, cityId: null, areaId: null }),
    [set],
  );
  const setCity = useCallback((cityId) => set({ cityId, areaId: null }), [set]);

  /**
   * A safety net for the case the handlers cannot cover: the lists arrive after
   * the value did, and the held child turns out not to belong to the parent —
   * a bookmarked URL, or a restored draft.
   */
  useEffect(() => {
    if (!value.cityId || !cities.data) return;
    if (!cities.data.some((city) => city.id === value.cityId)) {
      set({ cityId: null, areaId: null });
    }
  }, [cities.data, value.cityId, set]);

  useEffect(() => {
    if (!value.areaId || !areas.data) return;
    if (!areas.data.some((area) => area.id === value.areaId)) set({ areaId: null });
  }, [areas.data, value.areaId, set]);

  const adjacentAreas = adjacent.data ?? [];
  const areaById = new Map((areas.data ?? []).map((area) => [area.id, area]));

  return (
    <div className="space-y-4">
      <Field label={t('filters.province', { defaultValue: 'Province' })} error={errors.provinceId}>
        {(props) => (
          <Combobox
            {...props}
            label={t('filters.province', { defaultValue: 'Province' })}
            value={value.provinceId ?? null}
            onChange={setProvince}
            options={provinces.data ?? []}
            renderName={localName}
            disabled={disabled || provinces.isPending}
            invalid={Boolean(errors.provinceId)}
          />
        )}
      </Field>

      <Field label={t('filters.city')} error={errors.cityId}>
        {(props) => (
          <Combobox
            {...props}
            label={t('filters.city')}
            value={value.cityId ?? null}
            onChange={setCity}
            options={cities.data ?? []}
            renderName={localName}
            // Disabled rather than empty: an enabled control with nothing in it
            // looks broken, and the reason is upstream.
            disabled={disabled || !value.provinceId}
            placeholder={value.provinceId ? undefined : t('picker.chooseProvinceFirst')}
            invalid={Boolean(errors.cityId)}
          />
        )}
      </Field>

      <Field
        label={t('filters.area')}
        hint={t('picker.areaIsFinest')}
        error={errors.areaId}
      >
        {(props) => (
          <Combobox
            {...props}
            label={t('filters.area')}
            value={value.areaId ?? null}
            onChange={(areaId) => set({ areaId })}
            options={areas.data ?? []}
            renderName={localName}
            disabled={disabled || !value.cityId}
            placeholder={value.cityId ? undefined : t('picker.chooseCityFirst')}
            invalid={Boolean(errors.areaId)}
          />
        )}
      </Field>

      <Checkbox
        label={t('filters.adjacentAreas')}
        hint={t('picker.adjacentHint')}
        checked={Boolean(value.includeAdjacent)}
        disabled={disabled || !value.areaId}
        onChange={(event) => set({ includeAdjacent: event.target.checked })}
      />

      {/*
        Naming what the toggle added. A checkbox that silently widens a search
        leaves the user unable to explain their own results.
      */}
      {value.includeAdjacent && adjacentAreas.length > 0 ? (
        <div className="rounded-card border border-slate-line bg-paper p-3">
          <p className="text-caption font-medium text-slate">{t('picker.alsoSearching')}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {adjacentAreas.map((id) => {
              const area = areaById.get(id);
              const shown = area ? localName(area) : { text: id, lang: undefined };
              return (
                <li key={id}>
                  <Badge tone="info">
                    <span lang={shown.lang}>{shown.text}</span>
                  </Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {value.includeAdjacent && adjacent.isFetched && adjacentAreas.length === 0 ? (
        <p className="text-caption text-slate">{t('picker.noAdjacent')}</p>
      ) : null}
    </div>
  );
}
