/**
 * Search — §6.7, §6.16, §6.18, §6.19.
 *
 * ── Filters live in the URL ────────────────────────────────────────────────
 * `useSearchParams`, not component state. A parent comparing tutors will open
 * three profiles in three tabs and come back, and a filter set that evaporates
 * on navigation makes that impossible. It also means a search is a link — which
 * is how a mother sends one to her husband.
 *
 * ── No layout shift ────────────────────────────────────────────────────────
 * The skeleton is the same height as a real card, and `placeholderData` keeps
 * the previous results on screen while new ones load. Changing a filter dims
 * the list rather than emptying it, so the page never collapses to nothing and
 * springs back — which on a phone moves the card out from under a thumb that is
 * already descending.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { GENDER_PREFERENCES } from '@shared/search';
import { rupeesToPaisa } from '@shared/rates';

import { Button } from '../../components/ui/Button';
import { Card, CardBody, ErrorState } from '../../components/ui/Card';
import { Checkbox, Field, Input, Select } from '../../components/ui/Field';
import { CurriculumPicker } from '../../components/pickers/CurriculumPicker';
import { LocationPicker } from '../../components/pickers/LocationPicker';
import { ComparisonView } from '../../components/search/ComparisonView';
import { GenderRestrictionBanner } from '../../components/search/GenderRestrictionBanner';
import { NoResults } from '../../components/search/NoResults';
import { ResultCard, ResultCardSkeleton } from '../../components/search/ResultCard';
import { useComparisonTray } from '../../context/ComparisonTrayContext';
import { api } from '../../lib/api';
import { keys } from '../../lib/queryClient';

const PAGE_SIZE = 20;

/** URL params to the query object the API takes. */
function readQuery(params) {
  const get = (key) => params.get(key) || undefined;
  const bool = (key) => params.get(key) === 'true';

  return {
    subjectId: get('subjectId'),
    levelId: get('levelId'),
    boardId: get('boardId'),
    topicIds: params.getAll('topicIds'),
    cityId: get('cityId'),
    areaId: get('areaId'),
    includeAdjacentAreas: bool('includeAdjacentAreas'),
    mode: get('mode'),
    engagementType: get('engagementType'),
    genderPreference: get('genderPreference') ?? 'no_preference',
    maxHourlyRate: get('maxHourlyRate') ? Number(get('maxHourlyRate')) : undefined,
    verifiedOnly: bool('verifiedOnly'),
    volunteerOnly: bool('volunteerOnly'),
    availableWeekday: get('availableWeekday') ? Number(get('availableWeekday')) : undefined,
    availableFrom: get('availableFrom'),
    availableTo: get('availableTo'),
    sort: get('sort') ?? 'relevance',
    offset: Number(get('offset') ?? 0),
    limit: PAGE_SIZE,
  };
}

function toSearchString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else params.set(key, String(value));
  }
  return params.toString();
}

export default function Search() {
  const { t } = useTranslation(['search', 'booking', 'tutor', 'common']);
  const [params, setParams] = useSearchParams();
  const tray = useComparisonTray();
  const [showComparison, setShowComparison] = useState(false);

  const query = useMemo(() => readQuery(params), [params]);

  const update = useCallback(
    (patch) => {
      // Any filter change returns to the first page. Staying on page three of
      // a different result set shows an empty list that reads as no matches.
      setParams(toSearchString({ ...query, ...patch, offset: 0 }), { replace: true });
    },
    [query, setParams],
  );

  const results = useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.get(`/search?${toSearchString(query)}`),
    placeholderData: keepPreviousData,
  });

  const data = results.data;
  const isEmpty = data && data.results.length === 0;

  return (
    <div className="mx-auto max-w-wide px-4 py-6">
      <h1 className="font-display text-display text-ink">{t('title')}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
        {/* --- Filters ---------------------------------------------------- */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <Card>
            <CardBody className="space-y-5">
              <h2 className="font-display text-subtitle text-ink">{t('filters.heading')}</h2>

              <CurriculumPicker
                value={{
                  subjectId: query.subjectId,
                  levelId: query.levelId,
                  boardId: query.boardId,
                  topicIds: query.topicIds,
                }}
                onChange={update}
              />

              <LocationPicker
                value={{
                  cityId: query.cityId,
                  areaId: query.areaId,
                  includeAdjacent: query.includeAdjacentAreas,
                }}
                onChange={(next) =>
                  update({
                    cityId: next.cityId,
                    areaId: next.areaId,
                    includeAdjacentAreas: next.includeAdjacent,
                  })
                }
              />

              {/*
                Gender preference sits apart from the other filters, in its own
                bordered fieldset with its own explanation. It is not one chip
                among ten — see `GenderRestrictionBanner` for why that
                distinction carries the product's credibility.
              */}
              <fieldset className="rounded-card border-2 border-slate-line p-3">
                <legend className="px-1 text-small font-semibold text-ink">
                  {t('filters.gender')}
                </legend>
                <p className="mb-2 text-caption text-slate">{t('genderNote')}</p>
                <Select
                  aria-label={t('filters.gender')}
                  value={query.genderPreference}
                  onChange={(event) => update({ genderPreference: event.target.value })}
                >
                  {GENDER_PREFERENCES.map((value) => (
                    <option key={value} value={value}>
                      {t(
                        value === 'female_only'
                          ? 'filters.genderFemale'
                          : value === 'male_only'
                            ? 'filters.genderMale'
                            : 'filters.genderAny',
                      )}
                    </option>
                  ))}
                </Select>
              </fieldset>

              <Field label={t('filters.mode')}>
                {(props) => (
                  <Select
                    {...props}
                    value={query.mode ?? ''}
                    onChange={(event) => update({ mode: event.target.value || undefined })}
                  >
                    <option value="">{t('filters.anyMode')}</option>
                    {['home', 'online', 'own_place'].map((mode) => (
                      <option key={mode} value={mode}>
                        {t(`mode.${mode}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t('filters.engagement')}>
                {(props) => (
                  <Select
                    {...props}
                    value={query.engagementType ?? ''}
                    onChange={(event) =>
                      update({ engagementType: event.target.value || undefined })
                    }
                  >
                    <option value="">{t('filters.anyEngagement')}</option>
                    {['monthly', 'short_term_package', 'single_session', 'group'].map((type) => (
                      <option key={type} value={type}>
                        {t(`booking:engagement.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t('filters.budget')} hint={t('filters.budgetHint')}>
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    defaultValue={query.maxHourlyRate ? Math.round(query.maxHourlyRate / 100) : ''}
                    onBlur={(event) => {
                      const rupees = Number(event.target.value.replace(/[^\d]/g, ''));
                      update({ maxHourlyRate: rupees ? rupeesToPaisa(rupees) : undefined });
                    }}
                  />
                )}
              </Field>

              <Checkbox
                label={t('filters.verifiedOnly')}
                hint={t('filters.verifiedOnlyHint')}
                checked={query.verifiedOnly}
                onChange={(event) => update({ verifiedOnly: event.target.checked })}
              />

              <Checkbox
                label={t('filters.volunteerOnly')}
                hint={t('filters.volunteerOnlyHint')}
                checked={query.volunteerOnly}
                onChange={(event) => update({ volunteerOnly: event.target.checked })}
              />

              <Field label={t('filters.availableWeekday')}>
                {(props) => (
                  <Select
                    {...props}
                    value={query.availableWeekday ?? ''}
                    onChange={(event) =>
                      update({
                        availableWeekday: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  >
                    <option value="">{t('filters.anyDay')}</option>
                    {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                      <option key={day} value={day}>
                        {t(`tutor:availability.weekday.${day}`, { defaultValue: String(day) })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Button variant="ghost" fullWidth onClick={() => setParams('')}>
                {t('filters.clear')}
              </Button>
            </CardBody>
          </Card>
        </aside>

        {/* --- Results ---------------------------------------------------- */}
        <div className="min-w-0 space-y-4">
          {/*
            Rendered from the server's `appliedGenderPreference`, not from the
            local filter, so it states what actually happened rather than what
            was asked for.
          */}
          <GenderRestrictionBanner
            appliedGenderPreference={data?.appliedGenderPreference}
            resultCount={data?.total}
            onClear={() => update({ genderPreference: 'no_preference' })}
          />

          {tray.count > 0 ? (
            <Card className="border-verdigris/30">
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-small text-ink">
                  {t('compare.trayCount', { count: tray.count, max: tray.max })}
                </p>
                <Button size="sm" variant="accent" onClick={() => setShowComparison((v) => !v)}>
                  {showComparison ? t('compare.hide') : t('compare.show')}
                </Button>
              </CardBody>
            </Card>
          ) : null}

          {showComparison ? <ComparisonView /> : null}

          {results.isError ? <ErrorState error={results.error} onRetry={results.refetch} /> : null}

          {results.isPending ? (
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <ResultCardSkeleton key={index} />
              ))}
            </div>
          ) : isEmpty ? (
            <NoResults query={query} onWiden={() => update({ includeAdjacentAreas: true })} />
          ) : data ? (
            <>
              <p className="text-small text-slate" aria-live="polite">
                {t('resultCount', { count: data.total })}
                {typeof data.tookMs === 'number' ? (
                  <span className="ms-2 font-mono text-caption tnum text-slate-light">
                    {t('tookMs', { ms: data.tookMs })}
                  </span>
                ) : null}
              </p>

              {/* Dimmed rather than removed while refetching — no collapse. */}
              <div
                className={`space-y-3 transition-opacity ${
                  results.isFetching ? 'opacity-60' : 'opacity-100'
                }`}
              >
                {data.results.map((result) => (
                  <ResultCard key={result.tutor.id} result={result} />
                ))}
              </div>

              {data.total > PAGE_SIZE ? (
                <nav
                  aria-label={t('pagination.label')}
                  className="flex items-center justify-between gap-3 pt-2"
                >
                  <Button
                    variant="secondary"
                    disabled={query.offset === 0}
                    onClick={() =>
                      setParams(
                        toSearchString({
                          ...query,
                          offset: Math.max(0, query.offset - PAGE_SIZE),
                        }),
                      )
                    }
                  >
                    {t('pagination.previous')}
                  </Button>

                  <span className="font-mono text-caption tnum text-slate">
                    {t('pagination.position', {
                      from: query.offset + 1,
                      to: Math.min(query.offset + PAGE_SIZE, data.total),
                      total: data.total,
                    })}
                  </span>

                  <Button
                    variant="secondary"
                    disabled={query.offset + PAGE_SIZE >= data.total}
                    onClick={() =>
                      setParams(toSearchString({ ...query, offset: query.offset + PAGE_SIZE }))
                    }
                  >
                    {t('pagination.next')}
                  </Button>
                </nav>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
