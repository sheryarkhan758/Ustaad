/**
 * Verification appeals — §6.28, FR-28.6, SEC-18, decision 12.
 *
 * ── Why a human sits here at all ───────────────────────────────────────────
 * A competency verdict is produced by a model scoring an assessment. Decision
 * 12: an automated verdict affecting somebody's livelihood must not be final.
 * This screen is that principle's only implementation — without it the appeal
 * right exists in the specification and nowhere a tutor can reach.
 *
 * ── The override is permanent, and the screen says so before it is made ────
 * Upholding an appeal writes a new record that supersedes the original; it does
 * not erase it (§2.7). Both stay. So the administrator's reason becomes the
 * lasting public account of why a machine's verdict was set aside by a person,
 * and it is worth knowing that while writing it rather than afterwards.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { VERIFIABLE_ARTEFACTS } from '@shared/badges';

import { QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { UserText } from '../../components/ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

export default function AdminAppeals() {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState(null);
  const [artefacts, setArtefacts] = useState([]);

  const queue = useQuery({
    queryKey: ['admin', 'appeals'],
    queryFn: async () => (await api.get('/admin/verifications/appeals/open'))?.appeals ?? [],
  });

  const decide = useMutation({
    mutationFn: ({ id, outcome, reason }) =>
      api.post(`/admin/verifications/appeals/${id}/decide`, {
        outcome,
        reason,
        artefactsChecked: artefacts,
      }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      setOpenId(null);
      setArtefacts([]);
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  if (queue.isPending) {
    return (
      <QueuePage title={t('appeals.title')} intro={t('appeals.intro')}>
        <SkeletonCard label={t('common:state.loading')} />
      </QueuePage>
    );
  }

  if (queue.isError) {
    return (
      <QueuePage title={t('appeals.title')} intro={t('appeals.intro')}>
        <ErrorState error={queue.error} onRetry={queue.refetch} />
      </QueuePage>
    );
  }

  const appeals = queue.data ?? [];

  return (
    <QueuePage title={t('appeals.title')} intro={t('appeals.intro')}>
      {appeals.length === 0 ? (
        <EmptyState title={t('common.empty')} description={t('common.emptyBody')} />
      ) : null}

      {appeals.map((appeal) => (
        <Card key={appeal.id}>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-subtitle text-ink">{appeal.tutorId}</h2>
              <span className="text-caption text-slate">{fmt.date(appeal.filedAt)}</span>
            </div>

            <p className="text-caption text-slate">
              {t('appeals.originalVerdict')}: {appeal.track} · {appeal.againstRecordId}
            </p>

            <div>
              <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
                {t('appeals.grounds')}
              </h3>
              {/* Her own words, unchanged and never translated (§2.10). */}
              <UserText className="mt-1 text-small text-ink">{appeal.tutorReason}</UserText>
            </div>

            {openId === appeal.id ? (
              <ReasonForm
                busy={decide.isPending}
                note={t('appeals.permanent')}
                options={[
                  { value: 'uphold', label: t('appeals.uphold'), tone: 'primary' },
                  { value: 'dismiss', label: t('appeals.dismiss') },
                ]}
                onSubmit={(outcome, reason) =>
                  decide.mutateAsync({ id: appeal.id, outcome, reason })
                }
              >
                {/*
                  Upholding an identity rejection records what the override
                  itself checked — the badge that results comes from these, not
                  from the superseded record's list.
                */}
                <fieldset className="flex flex-wrap items-center gap-2">
                  <legend className="w-full text-caption text-slate">
                    {t('verification.checklist')}
                  </legend>
                  {VERIFIABLE_ARTEFACTS.map((artefact) => (
                    <label
                      key={artefact}
                      className="flex items-center gap-1.5 text-caption text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={artefacts.includes(artefact)}
                        onChange={() =>
                          setArtefacts((current) =>
                            current.includes(artefact)
                              ? current.filter((a) => a !== artefact)
                              : [...current, artefact],
                          )
                        }
                        className="h-4 w-4 accent-verdigris-deep"
                      />
                      {t(`verification.artefact.${artefact}`)}
                    </label>
                  ))}
                </fieldset>
              </ReasonForm>
            ) : (
              <Button variant="secondary" onClick={() => setOpenId(appeal.id)}>
                {t('appeals.decide')}
              </Button>
            )}
          </CardBody>
        </Card>
      ))}
    </QueuePage>
  );
}
