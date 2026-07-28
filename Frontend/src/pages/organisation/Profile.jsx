/**
 * Organisation profile — §6.13, FR-13.1.
 *
 * ── Deliberately small, per decision 4 ─────────────────────────────────────
 * The Organisation role was trimmed to "search plus an interest-based vacancy
 * board": roughly a day of work rather than four, while still serving the
 * stated use case. That trim is a design decision, not a shortcut, and this
 * screen respects it — a profile, and nothing that starts to become a hiring
 * product.
 *
 * ── Approved on the same terms as a tutor ──────────────────────────────────
 * FR-6.11: an administrator reviews this before it is shown. The status is
 * stated plainly, including the written reason when it was not approved,
 * because an academy told only "rejected" cannot fix anything.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/ui/Button';
import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../lib/api';
import { useAreas, useCities, useLocalName } from '../../lib/reference';

const ORG_TYPES = ['academy', 'school', 'tuition_centre', 'other'];

export default function OrgProfile() {
  const { t } = useTranslation(['organisation', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const localName = useLocalName();

  const [form, setForm] = useState({
    orgName: '',
    orgType: 'academy',
    description: '',
    website: '',
    cityId: '',
    areaId: '',
    contactEmail: '',
    contactPhone: '',
  });
  const [errors, setErrors] = useState({});

  const profile = useQuery({
    queryKey: ['organisation', 'me'],
    queryFn: async () => {
      try {
        return (await api.get('/organisations/me'))?.organisation ?? null;
      } catch (error) {
        // A profile that does not exist yet is the ordinary first visit, not a
        // failure: the form should be empty and usable, not an error screen.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });

  useEffect(() => {
    const saved = profile.data;
    if (!saved) return;
    setForm({
      orgName: saved.orgName ?? '',
      orgType: saved.orgType ?? 'academy',
      description: saved.description ?? '',
      website: saved.website ?? '',
      cityId: saved.cityId ?? '',
      areaId: saved.areaId ?? '',
      contactEmail: saved.contactEmail ?? '',
      contactPhone: saved.contactPhone ?? '',
    });
  }, [profile.data]);

  const cities = useCities(null);
  const areas = useAreas(form.cityId || null);

  const save = useMutation({
    mutationFn: (body) => api.put('/organisations/me', body),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('profile.saved') });
      queryClient.invalidateQueries({ queryKey: ['organisation'] });
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

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  function submit(event) {
    event.preventDefault();
    setErrors({});
    // Empty optional strings are sent as null rather than "": the schema takes
    // a nullable string, and "" would store an empty website as though set.
    const clean = (value) => (value.trim() === '' ? null : value.trim());
    save.mutate({
      orgName: form.orgName.trim(),
      orgType: form.orgType,
      description: clean(form.description),
      website: clean(form.website),
      cityId: form.cityId,
      areaId: clean(form.areaId),
      contactEmail: clean(form.contactEmail),
      contactPhone: clean(form.contactPhone),
    });
  }

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={profile.error} onRetry={profile.refetch} />
      </div>
    );
  }

  const approval = profile.data?.approvalStatus ?? profile.data?.status ?? null;

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('profile.title')}</h1>
        <p className="mt-1 text-small text-slate">{t('profile.intro')}</p>
      </header>

      {approval ? (
        <Card>
          <CardBody className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h2 className="text-caption font-semibold uppercase tracking-wide text-slate">
                {t('profile.status.heading')}
              </h2>
              <Badge tone={approval === 'approved' ? 'settled' : 'neutral'}>{approval}</Badge>
            </div>
            <p className="text-small text-ink">
              {t(`profile.status.${approval}`, { defaultValue: approval })}
            </p>
            {profile.data?.decisionReason ? (
              <p className="text-caption text-slate">
                {t('profile.status.reason', { reason: profile.data.decisionReason })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <form onSubmit={submit} noValidate>
        <Card>
          <CardBody className="space-y-4">
            <Field label={t('profile.orgName')} error={errors.orgName} htmlFor="org-name">
              {(props) => (
                <Input
                  {...props}
                  id="org-name"
                  value={form.orgName}
                  onChange={(event) => set({ orgName: event.target.value })}
                />
              )}
            </Field>

            <Field label={t('profile.orgType')} error={errors.orgType} htmlFor="org-type">
              {(props) => (
                <Select
                  {...props}
                  id="org-type"
                  value={form.orgType}
                  onChange={(event) => set({ orgType: event.target.value })}
                >
                  {ORG_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`profile.type.${type}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label={t('profile.description')}
              hint={t('profile.descriptionHint')}
              error={errors.description}
              htmlFor="org-description"
            >
              {(props) => (
                <Textarea
                  {...props}
                  id="org-description"
                  rows={4}
                  value={form.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              )}
            </Field>

            <Field label={t('profile.city')} error={errors.cityId} htmlFor="org-city">
              {(props) => (
                <Select
                  {...props}
                  id="org-city"
                  value={form.cityId}
                  onChange={(event) => set({ cityId: event.target.value, areaId: '' })}
                >
                  <option value="">—</option>
                  {(cities.data ?? []).map((city) => (
                    <option key={city.id} value={city.id}>
                      {localName(city).text}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {form.cityId ? (
              <Field
                label={t('profile.area')}
                hint={t('profile.areaHint')}
                error={errors.areaId}
                htmlFor="org-area"
              >
                {(props) => (
                  <Select
                    {...props}
                    id="org-area"
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

            <Field label={t('profile.website')} error={errors.website} htmlFor="org-website">
              {(props) => (
                <Input
                  {...props}
                  id="org-website"
                  type="url"
                  value={form.website}
                  onChange={(event) => set({ website: event.target.value })}
                />
              )}
            </Field>

            <Field
              label={t('profile.contactEmail')}
              error={errors.contactEmail}
              htmlFor="org-email"
            >
              {(props) => (
                <Input
                  {...props}
                  id="org-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => set({ contactEmail: event.target.value })}
                />
              )}
            </Field>

            <Field
              label={t('profile.contactPhone')}
              error={errors.contactPhone}
              htmlFor="org-phone"
            >
              {(props) => (
                <Input
                  {...props}
                  id="org-phone"
                  value={form.contactPhone}
                  onChange={(event) => set({ contactPhone: event.target.value })}
                />
              )}
            </Field>

            <Button type="submit" variant="accent" busy={save.isPending}>
              {t('profile.save')}
            </Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
