/**
 * The unmet demand board — §6.24.
 *
 * ── What this screen is ────────────────────────────────────────────────────
 * The platform's failed searches, turned into supply intelligence. A female
 * tutor learning that eleven families in her district looked for a female
 * Mathematics tutor last month has information she cannot get anywhere else,
 * and information the platform would otherwise have thrown away.
 *
 * ── Counts, and nothing that could become a person ─────────────────────────
 * FR-24.5 and FR-24.2: no requester identity is stored, so none can be shown.
 * That is easy to honour and easy to *imply* otherwise — a "contact" button, a
 * "3 families waiting" phrased as though they could be replied to, a row that
 * looks like a lead. There is none of that here, and the board says plainly
 * what it is: a count with nobody attached and no way to reach anyone.
 *
 * ── Why the filters cannot be used to strip the suppression ────────────────
 * Every field a caller may filter on — subject, level, area, gender preference
 * — is already part of the cohort key. So a filter selects whole cohorts and
 * can never carve one into pieces small enough to slip under the threshold of
 * three. The window is a constant for the same reason and is not offered as a
 * control at all: two overlapping windows subtract to the records in between.
 * The page states both, because a tutor who understands why a group is missing
 * will not go looking for a way to see it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Field';
import { api } from '../../lib/api';
import {
  useAreas,
  useCities,
  useLevels,
  useLocalName,
  useSubjects,
  useTopics,
} from '../../lib/reference';

const GENDER_PREFERENCES = ['no_preference', 'female_only', 'male_only'];

function Cohort({ cohort, nameOf }) {
  const { t } = useTranslation(['demand', 'search']);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-subtitle text-ink">{nameOf.subject(cohort.subjectId)}</h3>
            <p className="mt-0.5 text-caption text-slate">
              {cohort.levelId ? nameOf.level(cohort.levelId) : t('board.anyLevel')} ·{' '}
              {cohort.areaId ? nameOf.area(cohort.areaId) : t('board.anyArea')}
            </p>
          </div>
          {/* The figure, as a figure. Not "3 leads", not "3 waiting". */}
          <p className="font-mono text-body tnum text-ink">
            {t('board.cohortCount', { count: cohort.count })}
          </p>
        </div>

        {cohort.genderPreference !== 'no_preference' ? (
          <Badge tone="info">{t(`search:gender.${cohort.genderPreference}`)}</Badge>
        ) : null}

        {cohort.topics?.length > 0 ? (
          <div>
            <h4 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {t('board.topics')}
            </h4>
            <ul className="mt-1 space-y-0.5 text-small text-ink">
              {cohort.topics.map((topic) => (
                <li key={topic.topicId}>
                  {nameOf.topic(topic.topicId)} — {topic.count}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {cohort.budgetBandLabels?.length > 0 ? (
          <p className="text-caption text-slate">
            <span className="font-medium text-ink">{t('board.budgets')}:</span>{' '}
            {cohort.budgetBandLabels.join('، ')}
          </p>
        ) : null}

        {cohort.reasons?.length > 0 ? (
          <p className="text-caption text-slate">
            <span className="font-medium text-ink">{t('board.reasons')}:</span>{' '}
            {cohort.reasons
              .map((r) => `${t(`board.reason.${r.reason}`, { defaultValue: r.reason })} (${r.count})`)
              .join('، ')}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default function DemandBoard() {
  const { t } = useTranslation(['demand', 'search', 'common']);
  const localName = useLocalName();

  const [filters, setFilters] = useState({
    subjectId: '',
    levelId: '',
    areaId: '',
    genderPreference: '',
  });
  const [cityId, setCityId] = useState('');

  const subjects = useSubjects();
  const levels = useLevels();
  const cities = useCities(null);
  const areas = useAreas(cityId || null);

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== ''),
  ).toString();

  const board = useQuery({
    queryKey: ['demand', 'board', query],
    queryFn: async () => api.get(`/demand${query ? `?${query}` : ''}`),
  });

  const topics = useTopics({
    subjectId: filters.subjectId || undefined,
    levelId: filters.levelId || undefined,
  });

  const nameOf = {
    subject: (id) => {
      const row = (subjects.data ?? []).find((s) => s.id === id);
      return row ? localName(row).text : id;
    },
    level: (id) => {
      const row = (levels.data ?? []).find((l) => l.id === id);
      return row ? localName(row).text : id;
    },
    area: (id) => {
      const row = (areas.data ?? []).find((a) => a.id === id);
      return row ? localName(row).text : id;
    },
    topic: (id) => {
      const row = (topics.data ?? []).find((tp) => tp.id === id);
      return row ? localName(row).text : id;
    },
  };

  const set = (patch) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header className="space-y-2">
        <h1 className="font-display text-display text-ink">{t('board.title')}</h1>
        <p className="text-body text-slate">{t('board.intro')}</p>
        {/* Said before the numbers, not after them. */}
        <p className="rounded-control bg-paper-sunk px-3 py-2 text-small text-ink">
          {t('board.noIdentity')}
        </p>
      </header>

      {/* --- Filters ------------------------------------------------------- */}
      <Card>
        <CardBody className="space-y-3">
          <h2 className="font-display text-subtitle text-ink">{t('board.filters')}</h2>

          <Field label={t('search:filters.subject')} htmlFor="demand-subject">
            {(props) => (
              <Select
                {...props}
                id="demand-subject"
                value={filters.subjectId}
                onChange={(event) => set({ subjectId: event.target.value })}
              >
                <option value="">{t('common:field.optional')}</option>
                {(subjects.data ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {localName(subject).text}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('search:filters.level')} htmlFor="demand-level">
            {(props) => (
              <Select
                {...props}
                id="demand-level"
                value={filters.levelId}
                onChange={(event) => set({ levelId: event.target.value })}
              >
                <option value="">{t('board.anyLevel')}</option>
                {(levels.data ?? []).map((level) => (
                  <option key={level.id} value={level.id}>
                    {localName(level).text}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('search:filters.city')} htmlFor="demand-city">
            {(props) => (
              <Select
                {...props}
                id="demand-city"
                value={cityId}
                onChange={(event) => {
                  setCityId(event.target.value);
                  set({ areaId: '' });
                }}
              >
                <option value="">{t('board.anyArea')}</option>
                {(cities.data ?? []).map((city) => (
                  <option key={city.id} value={city.id}>
                    {localName(city).text}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {cityId ? (
            <Field label={t('search:filters.area')} htmlFor="demand-area">
              {(props) => (
                <Select
                  {...props}
                  id="demand-area"
                  value={filters.areaId}
                  onChange={(event) => set({ areaId: event.target.value })}
                >
                  <option value="">{t('board.anyArea')}</option>
                  {(areas.data ?? []).map((area) => (
                    <option key={area.id} value={area.id}>
                      {localName(area).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label={t('search:filters.gender')} htmlFor="demand-gender">
            {(props) => (
              <Select
                {...props}
                id="demand-gender"
                value={filters.genderPreference}
                onChange={(event) => set({ genderPreference: event.target.value })}
              >
                <option value="">{t('common:field.optional')}</option>
                {GENDER_PREFERENCES.map((option) => (
                  <option key={option} value={option}>
                    {t(`search:gender.${option}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <p className="text-caption text-slate">{t('board.filterNote')}</p>

          <Button
            variant="ghost"
            onClick={() => {
              setFilters({ subjectId: '', levelId: '', areaId: '', genderPreference: '' });
              setCityId('');
            }}
          >
            {t('board.clear')}
          </Button>
        </CardBody>
      </Card>

      {/* --- The board ----------------------------------------------------- */}
      {board.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
      {board.isError ? <ErrorState error={board.error} onRetry={board.refetch} /> : null}

      {board.data ? (
        <section className="space-y-3">
          <div className="space-y-1">
            <p className="text-small text-ink">
              {t('board.totalInWindow', { count: board.data.totalRecordsInWindow ?? 0 })}
            </p>
            <p className="text-caption text-slate">{t('board.windowNote')}</p>
          </div>

          {(board.data.cohorts ?? []).length === 0 ? (
            <EmptyState title={t('board.empty')} description={t('board.emptyBody')} />
          ) : (
            (board.data.cohorts ?? []).map((cohort) => (
              <Cohort key={cohort.cohortKey} cohort={cohort} nameOf={nameOf} />
            ))
          )}

          {/* Stated rather than silently omitted: a board that hid its own
              omissions would read as complete when it is not (SEC-16). */}
          {board.data.suppressedCohortCount > 0 ? (
            <div className="rounded-control border border-slate-line px-3 py-2">
              <p className="text-small text-ink">
                {t('board.suppressed', { count: board.data.suppressedCohortCount })}
              </p>
              <p className="mt-0.5 text-caption text-slate">{t('board.suppressedWhy')}</p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
