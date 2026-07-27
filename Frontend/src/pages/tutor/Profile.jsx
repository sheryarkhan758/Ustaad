/**
 * The tutor's own profile — §6.4, §6.5, §6.29.2.
 *
 * Assembles the pieces: the profile fields, subject claims, the rate table and
 * the safety constraints, with the completeness indicator alongside.
 *
 * ── Bio in both languages, and neither is a translation of the other ───────
 * A tutor may write in English, in Urdu, or in both — and if she writes both,
 * they are two things she chose to say, not one thing said twice. Neither is
 * ever machine-translated (§2.10, FR-27.5), and the field labels say so.
 *
 * ── No tutor-facing control writes `approved` ──────────────────────────────
 * She can move her profile from draft to pending by submitting. Everything
 * after that belongs to an administrator (§2.5), which is why the only status
 * control on this page is "submit for verification" and it lives on the
 * verification screen rather than here.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/Field';
import { Combobox } from '../../components/ui/Combobox';
import { ClaimList } from '../../components/tutor/ClaimList';
import { RateBuilder } from '../../components/tutor/RateBuilder';
import { SafetyPanel } from '../../components/tutor/SafetyPanel';
import { CompletenessPanel, computeCompleteness } from '../../components/tutor/VerificationStatus';
import { CurriculumPicker } from '../../components/pickers/CurriculumPicker';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import {
  useAreas,
  useBoards,
  useCities,
  useLevels,
  useLocalName,
  useSubjects,
  useTopics,
} from '../../lib/reference';

const tutorKeys = {
  profile: ['tutor', 'profile'],
  claims: ['tutor', 'claims'],
  rates: ['tutor', 'rates'],
  safety: ['tutor', 'safety'],
  availability: ['tutor', 'availability'],
  documents: ['tutor', 'documents'],
};

function useTutorResource(key, path) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const payload = await api.get(path);
      return payload?.items ?? payload?.profile ?? payload?.constraints ?? null;
    },
  });
}

export default function TutorProfile() {
  const { t } = useTranslation(['tutor', 'search', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const localName = useLocalName();

  const profile = useTutorResource(tutorKeys.profile, '/tutors/profile');
  const claims = useTutorResource(tutorKeys.claims, '/tutors/claims');
  const rates = useTutorResource(tutorKeys.rates, '/tutors/rates');
  const safety = useTutorResource(tutorKeys.safety, '/tutors/safety');
  const availability = useTutorResource(tutorKeys.availability, '/tutors/availability');
  const documents = useTutorResource(tutorKeys.documents, '/tutors/documents');

  const [draft, setDraft] = useState(null);
  const [newClaim, setNewClaim] = useState({});

  const cities = useCities(profile.data?.provinceId);
  const areas = useAreas(profile.data?.cityId);
  const subjects = useSubjects();
  const levels = useLevels();
  const boards = useBoards();
  const claimTopics = useTopics({
    subjectId: newClaim.subjectId,
    levelId: newClaim.levelId,
    boardId: newClaim.boardId,
  });

  const values = draft ?? profile.data ?? {};
  const set = (patch) => setDraft({ ...values, ...patch });

  const completeness = useMemo(
    () =>
      computeCompleteness({
        profile: profile.data,
        claims: claims.data ?? [],
        rates: rates.data ?? [],
        availability: availability.data ?? [],
        documents: documents.data ?? [],
      }),
    [profile.data, claims.data, rates.data, availability.data, documents.data],
  );

  const invalidate = (key) => queryClient.invalidateQueries({ queryKey: key });

  const saveProfile = useMutation({
    mutationFn: (body) =>
      profile.data ? api.patch('/tutors/profile', body) : api.post('/tutors/profile', body),
    onSuccess: () => {
      invalidate(tutorKeys.profile);
      setDraft(null);
      toast.forAction('saveProfile');
    },
  });

  const addClaim = useMutation({
    mutationFn: (body) => api.post('/tutors/claims', body),
    onSuccess: () => {
      invalidate(tutorKeys.claims);
      setNewClaim({});
      toast.show({ title: t('claims.added') });
    },
  });

  const removeClaim = useMutation({
    mutationFn: (id) => api.del(`/tutors/claims/${id}`),
    onSuccess: () => invalidate(tutorKeys.claims),
  });

  const addRate = useMutation({
    mutationFn: (body) => api.post('/tutors/rates', body),
    onSuccess: () => invalidate(tutorKeys.rates),
  });

  const removeRate = useMutation({
    mutationFn: (id) => api.del(`/tutors/rates/${id}`),
    onSuccess: () => invalidate(tutorKeys.rates),
  });

  const saveSafety = useMutation({
    mutationFn: (body) => api.put('/tutors/safety', body),
    onSuccess: () => {
      invalidate(tutorKeys.safety);
      toast.show({ title: t('safety.saved') });
    },
  });

  if (profile.isPending) return <SkeletonCard label={t('common:state.loading')} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="min-w-0 space-y-6">
        {profile.isError ? <ErrorState error={profile.error} onRetry={profile.refetch} /> : null}

        {/* --- Profile fields ------------------------------------------- */}
        <Card>
          <CardHeader title={t('profile.title')} />
          <CardBody className="space-y-5">
            <Field label={t('search:filters.city')} required>
              {(props) => (
                <Combobox
                  {...props}
                  label={t('search:filters.city')}
                  value={values.cityId ?? null}
                  onChange={(cityId) => set({ cityId })}
                  options={cities.data ?? []}
                  renderName={localName}
                />
              )}
            </Field>

            <Field label={t('profile.qualifications')} required>
              {(props) => (
                <Input
                  {...props}
                  value={values.qualifications ?? ''}
                  onChange={(event) => set({ qualifications: event.target.value })}
                  placeholder="MSc Mathematics, University of Karachi"
                />
              )}
            </Field>

            <Field label={t('profile.experience')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  max="60"
                  value={values.experienceYears ?? 0}
                  onChange={(event) => set({ experienceYears: Number(event.target.value) })}
                />
              )}
            </Field>

            {/*
              Two biographies, not a translation pair. Whichever she writes is
              stored byte for byte and shown verbatim (§2.10).
            */}
            <Field label={t('profile.biography')} hint={t('profile.biographyHint')}>
              {(props) => (
                <Textarea
                  {...props}
                  lang="en"
                  dir="auto"
                  value={values.bio ?? ''}
                  onChange={(event) => set({ bio: event.target.value })}
                />
              )}
            </Field>

            <Field label={t('profile.biographyUr')} hint={t('profile.biographyUrHint')}>
              {(props) => (
                <Textarea
                  {...props}
                  lang="ur"
                  dir="auto"
                  className="font-urdu text-urdu-body"
                  value={values.bioUr ?? ''}
                  onChange={(event) => set({ bioUr: event.target.value })}
                />
              )}
            </Field>

            <fieldset>
              <legend className="text-small font-medium text-ink">{t('profile.modes')}</legend>
              <div className="mt-2 space-y-1">
                <Checkbox
                  label={t('search:mode.home')}
                  checked={Boolean(values.teachesAtHome)}
                  onChange={(event) => set({ teachesAtHome: event.target.checked })}
                />
                <Checkbox
                  label={t('search:mode.online')}
                  checked={Boolean(values.teachesOnline)}
                  onChange={(event) => set({ teachesOnline: event.target.checked })}
                />
                <Checkbox
                  label={t('search:mode.own_place')}
                  checked={Boolean(values.teachesAtOwnPlace)}
                  onChange={(event) => set({ teachesAtOwnPlace: event.target.checked })}
                />
              </div>
            </fieldset>

            {values.teachesAtHome ? (
              <Field label={t('profile.areas')} hint={t('profile.areasHint')}>
                {(props) => (
                  <Combobox
                    {...props}
                    label={t('profile.areas')}
                    value={null}
                    onChange={(areaId) => {
                      const current = values.willingAreas ?? [];
                      if (areaId && !current.includes(areaId)) {
                        set({ willingAreas: [...current, areaId] });
                      }
                    }}
                    options={(areas.data ?? []).filter(
                      (area) => !(values.willingAreas ?? []).includes(area.id),
                    )}
                    renderName={localName}
                  />
                )}
              </Field>
            ) : null}

            {saveProfile.isError ? <ErrorState error={saveProfile.error} /> : null}

            <Button
              variant="primary"
              busy={saveProfile.isPending}
              disabled={!draft}
              onClick={() => saveProfile.mutate(values)}
            >
              {t('common:action.save')}
            </Button>
          </CardBody>
        </Card>

        {/* --- Claims --------------------------------------------------- */}
        <Card>
          <CardHeader title={t('claims.title', { defaultValue: 'Subjects you teach' })} />
          <CardBody className="space-y-5">
            <CurriculumPicker value={newClaim} onChange={setNewClaim} />
            <Button
              variant="accent"
              busy={addClaim.isPending}
              disabled={!newClaim.subjectId || !newClaim.levelId || !newClaim.boardId}
              onClick={() => addClaim.mutate(newClaim)}
            >
              {t('claims.add', { defaultValue: 'Add this claim' })}
            </Button>

            <ClaimList
              claims={claims.data ?? []}
              subjects={subjects.data}
              levels={levels.data}
              boards={boards.data}
              topics={claimTopics.data}
              onRemove={(id) => removeClaim.mutate(id)}
            />
          </CardBody>
        </Card>

        {/* --- Rates ---------------------------------------------------- */}
        <Card>
          <CardHeader title={t('rates.title')} />
          <CardBody>
            <RateBuilder
              rates={rates.data ?? []}
              onAdd={(rate) => addRate.mutate(rate)}
              onRemove={(id) => removeRate.mutate(id)}
              busy={addRate.isPending}
            />
          </CardBody>
        </Card>

        {/* --- Safety --------------------------------------------------- */}
        <Card>
          <CardHeader title={t('safety.title')} />
          <CardBody className="space-y-4">
            <SafetyPanel
              value={safety.data ?? {}}
              cityId={values.cityId}
              onChange={(next) => saveSafety.mutate(next)}
              disabled={saveSafety.isPending}
            />
          </CardBody>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-4">
        <CompletenessPanel completeness={completeness} />
      </aside>
    </div>
  );
}
