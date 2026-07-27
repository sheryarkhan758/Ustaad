/**
 * Vacancies and who answered them — §6.13, FR-13.3 to FR-13.6.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * There is no pipeline here. No shortlist column, no "contacted" toggle, no
 * stage a tutor can be dragged between. FR-13.5 describes exactly that and
 * decision 4 removed it, and the API has no route to reach those states — the
 * interest row can only ever say `expressed`.
 *
 * The reason is worth stating because the omission looks like an oversight
 * otherwise: an academy that can mark a tutor "rejected" inside the platform is
 * an academy making an employment decision inside a product that records it
 * against her name, on a platform she cannot see it from. A list of people who
 * put their hand up, and their public verification record, is what an academy
 * actually needs to pick up the phone.
 *
 * ── A posted vacancy is not editable ───────────────────────────────────────
 * Only its status changes. A tutor read the curriculum, the rate and the area
 * before expressing interest; rewriting those under her would change what she
 * agreed to look at without her knowing. Closing and reposting is the honest
 * operation and the page says so.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/ui/Button';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../lib/api';
import { useFormat } from '../../lib/format';
import {
  useAreas,
  useBoards,
  useCities,
  useLevels,
  useLocalName,
  useSubjects,
} from '../../lib/reference';

/** `TEACHING_MODES` from `shared/rates.ts`, and the dictionary keys match it. */
const MODES = ['home', 'online', 'own_place'];
const RATE_TYPES = ['monthly', 'hourly', 'per_session'];

/** The tutors who put their hand up. Read only, by design — see the header. */
function InterestedList({ vacancyId }) {
  const { t } = useTranslation(['organisation', 'common']);
  const fmt = useFormat();

  const interests = useQuery({
    queryKey: ['organisation', 'interests', vacancyId],
    queryFn: async () => (await api.get(`/organisations/me/vacancies/${vacancyId}/interests`))?.items ?? [],
  });

  if (interests.isPending) return <SkeletonCard label={t('common:state.loading')} />;
  if (interests.isError) return <ErrorState error={interests.error} onRetry={interests.refetch} />;

  const items = interests.data ?? [];

  if (items.length === 0) {
    return <EmptyState title={t('interested.empty')} description={t('interested.emptyBody')} />;
  }

  return (
    <div className="space-y-2">
      <h3 className="font-display text-small font-medium text-ink">{t('interested.heading')}</h3>
      <p className="text-caption text-slate">{t('interested.body')}</p>
      <ul className="space-y-2">
        {items.map((interest) => (
          <li
            key={interest.id ?? interest.tutorId}
            className="rounded-control border border-slate-line px-3 py-2"
          >
            <p className="text-small text-ink">{interest.displayName ?? interest.tutorId}</p>
            {interest.createdAt ? (
              <p className="text-caption text-slate">
                {t('interested.expressedOn', { date: fmt.date(interest.createdAt) })}
              </p>
            ) : null}
            {interest.slug ? (
              <Link
                to={`/t/${interest.slug}`}
                className="text-caption text-verdigris-deep hover:underline"
              >
                {t('interested.viewProfile')}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OrgVacancies() {
  const { t } = useTranslation(['organisation', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const fmt = useFormat();
  const localName = useLocalName();

  const [showing, setShowing] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    subjectId: '',
    levelId: '',
    boardId: '',
    mode: 'home',
    rateOffered: '',
    rateType: 'monthly',
    cityId: '',
    areaId: '',
    description: '',
  });

  const subjects = useSubjects();
  const levels = useLevels();
  const boards = useBoards();
  const cities = useCities(null);
  const areas = useAreas(form.cityId || null);

  const vacancies = useQuery({
    queryKey: ['organisation', 'vacancies'],
    queryFn: async () => (await api.get('/organisations/me/vacancies'))?.items ?? [],
  });

  const post = useMutation({
    mutationFn: (body) => api.post('/organisations/me/vacancies', body),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('vacancies.posted') });
      queryClient.invalidateQueries({ queryKey: ['organisation', 'vacancies'] });
      setForm((current) => ({ ...current, description: '', rateOffered: '' }));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isValidation) {
        setErrors(
          Object.fromEntries((error.issues ?? []).map((issue) => [issue.path, issue.message])),
        );
        return;
      }
      toast.show({ tone: 'error', title: error.message });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/organisations/me/vacancies/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organisation', 'vacancies'] }),
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  function submit(event) {
    event.preventDefault();
    setErrors({});

    const rate = form.rateOffered.trim();
    post.mutate({
      subjectId: form.subjectId,
      levelId: form.levelId,
      boardId: form.boardId || null,
      mode: form.mode,
      // Rupees on screen, paisa on the wire. Money is integer paisa everywhere
      // in this system, with no exceptions (§2.6).
      rateOffered: rate === '' ? null : Math.round(Number(rate) * 100),
      rateType: rate === '' ? null : form.rateType,
      areaId: form.areaId || null,
      description: form.description.trim() === '' ? null : form.description.trim(),
    });
  }

  const nameOf = (rows, id) => {
    const row = (rows ?? []).find((r) => r.id === id);
    return row ? localName(row).text : id;
  };

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('vacancies.title')}</h1>
        <p className="mt-1 text-small text-slate">{t('vacancies.intro')}</p>
      </header>

      {/* --- Post one — FR-13.3 ------------------------------------------- */}
      <form onSubmit={submit} noValidate>
        <Card>
          <CardBody className="space-y-4">
            <h2 className="font-display text-subtitle text-ink">{t('vacancies.postHeading')}</h2>

            <Field label={t('vacancies.subject')} error={errors.subjectId} htmlFor="v-subject">
              {(props) => (
                <Select
                  {...props}
                  id="v-subject"
                  value={form.subjectId}
                  onChange={(event) => set({ subjectId: event.target.value })}
                >
                  <option value="">—</option>
                  {(subjects.data ?? []).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {localName(subject).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t('vacancies.level')} error={errors.levelId} htmlFor="v-level">
              {(props) => (
                <Select
                  {...props}
                  id="v-level"
                  value={form.levelId}
                  onChange={(event) => set({ levelId: event.target.value })}
                >
                  <option value="">—</option>
                  {(levels.data ?? []).map((level) => (
                    <option key={level.id} value={level.id}>
                      {localName(level).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t('vacancies.board')} error={errors.boardId} htmlFor="v-board">
              {(props) => (
                <Select
                  {...props}
                  id="v-board"
                  value={form.boardId}
                  onChange={(event) => set({ boardId: event.target.value })}
                >
                  <option value="">{t('common:field.optional')}</option>
                  {(boards.data ?? []).map((board) => (
                    <option key={board.id} value={board.id}>
                      {localName(board).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label={t('vacancies.mode')} error={errors.mode} htmlFor="v-mode">
              {(props) => (
                <Select
                  {...props}
                  id="v-mode"
                  value={form.mode}
                  onChange={(event) => set({ mode: event.target.value })}
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`common:mode.${mode}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label={t('vacancies.rate')}
              hint={t('vacancies.rateHint')}
              error={errors.rateOffered}
              htmlFor="v-rate"
            >
              {(props) => (
                <Input
                  {...props}
                  id="v-rate"
                  inputMode="numeric"
                  value={form.rateOffered}
                  onChange={(event) => set({ rateOffered: event.target.value })}
                />
              )}
            </Field>

            {form.rateOffered.trim() !== '' ? (
              <Field label={t('vacancies.rateType')} error={errors.rateType} htmlFor="v-rate-type">
                {(props) => (
                  <Select
                    {...props}
                    id="v-rate-type"
                    value={form.rateType}
                    onChange={(event) => set({ rateType: event.target.value })}
                  >
                    {RATE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`common:rateType.${type}`, { defaultValue: type })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <Field label={t('vacancies.area')} error={errors.areaId} htmlFor="v-city">
              {(props) => (
                <Select
                  {...props}
                  id="v-city"
                  value={form.cityId}
                  onChange={(event) => set({ cityId: event.target.value, areaId: '' })}
                >
                  <option value="">{t('common:field.optional')}</option>
                  {(cities.data ?? []).map((city) => (
                    <option key={city.id} value={city.id}>
                      {localName(city).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {form.cityId ? (
              <Field label={t('vacancies.area')} htmlFor="v-area">
                {(props) => (
                  <Select
                    {...props}
                    id="v-area"
                    value={form.areaId}
                    onChange={(event) => set({ areaId: event.target.value })}
                  >
                    <option value="">—</option>
                    {(areas.data ?? []).map((area) => (
                      <option key={area.id} value={area.id}>
                        {localName(area).text}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <Field
              label={t('vacancies.description')}
              error={errors.description}
              htmlFor="v-description"
            >
              {(props) => (
                <Textarea
                  {...props}
                  id="v-description"
                  rows={3}
                  value={form.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              )}
            </Field>

            <Button type="submit" variant="accent" busy={post.isPending}>
              {t('vacancies.post')}
            </Button>
          </CardBody>
        </Card>
      </form>

      {/* --- Your vacancies ----------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="font-display text-subtitle text-ink">{t('vacancies.openHeading')}</h2>

        {vacancies.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
        {vacancies.isError ? (
          <ErrorState error={vacancies.error} onRetry={vacancies.refetch} />
        ) : null}

        {vacancies.data?.length === 0 ? (
          <EmptyState title={t('vacancies.empty')} description={t('vacancies.emptyBody')} />
        ) : null}

        {(vacancies.data ?? []).map((vacancy) => (
          <Card key={vacancy.id}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-small font-medium text-ink">
                    {nameOf(subjects.data, vacancy.subjectId)} ·{' '}
                    {nameOf(levels.data, vacancy.levelId)}
                  </h3>
                  <p className="mt-0.5 text-caption text-slate">
                    {t(`common:mode.${vacancy.mode}`)}
                    {vacancy.areaId ? ` · ${nameOf(areas.data, vacancy.areaId)}` : ''}
                  </p>
                </div>
                <Badge tone={vacancy.status === 'open' ? 'settled' : 'neutral'}>
                  {t(`vacancies.status.${vacancy.status}`, { defaultValue: vacancy.status })}
                </Badge>
              </div>

              {vacancy.rateOffered ? (
                <p className="font-mono text-small tnum text-ink">
                  {fmt.paisa(vacancy.rateOffered)}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {vacancy.status === 'open' ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setStatus.mutate({ id: vacancy.id, status: 'filled' })}
                    >
                      {t('vacancies.markFilled')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setStatus.mutate({ id: vacancy.id, status: 'closed' })}
                    >
                      {t('vacancies.close')}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => setStatus.mutate({ id: vacancy.id, status: 'open' })}
                  >
                    {t('vacancies.reopen')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setShowing(showing === vacancy.id ? null : vacancy.id)}
                >
                  {t('vacancies.viewInterested')}
                </Button>
              </div>

              <p className="text-caption text-slate">{t('vacancies.statusNote')}</p>

              {showing === vacancy.id ? (
                <div className="border-t border-slate-line pt-3">
                  <InterestedList vacancyId={vacancy.id} />
                </div>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </section>
    </div>
  );
}
