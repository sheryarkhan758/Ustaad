/**
 * The payment dispute queue — §6.31, FR-31.6.
 *
 * ── Both accounts, side by side ────────────────────────────────────────────
 * A dispute is two people describing the same engagement differently. Reading
 * one and then clicking to the other invites deciding on whichever was read
 * first; putting them in two columns of one row makes the comparison the
 * default action rather than an extra one.
 *
 * ── What a resolution is, and is not ───────────────────────────────────────
 * Ustaad.com records payments and never holds them (§2.6, SEC-23). So the
 * outcome here sets the recorded payment status and writes a reasoned finding
 * to the append-only log. It moves no money, because there is no money here to
 * move, and the screen says so beside the control rather than leaving an
 * administrator to infer that they have just issued a refund.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { UserText } from '../../components/ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/** The statuses a resolution may land on. `disputed` is where it already is. */
const OUTCOMES = ['settled', 'pending', 'family_marked'];

function Position({ heading, party, dispute, fmt, t }) {
  const raisedHere = dispute.raisedByParty === party;

  return (
    <div className="min-w-0 flex-1 rounded-control border border-slate-line px-3 py-2">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">{heading}</h3>

      {raisedHere ? (
        <>
          <p className="mt-1 text-small font-medium text-ink">{dispute.reason}</p>
          {/* The party's own words, verbatim (§2.10). */}
          {dispute.detail ? (
            <UserText className="mt-1 text-small text-ink">{dispute.detail}</UserText>
          ) : null}
          <p className="mt-1 text-caption text-slate">{fmt.date(dispute.raisedAt)}</p>
        </>
      ) : (
        <p className="mt-1 text-caption text-slate">{t('disputes.noPosition')}</p>
      )}
    </div>
  );
}

export default function AdminDisputes() {
  const { t } = useTranslation(['admin', 'common', 'payments']);
  const fmt = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState(null);

  const queue = useQuery({
    queryKey: ['admin', 'disputes'],
    queryFn: async () => api.get('/payments/admin/disputes'),
  });

  const resolve = useMutation({
    mutationFn: ({ id, outcome, reason }) =>
      api.post(`/payments/admin/disputes/${id}/resolve`, { outcome, reason }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      setOpenId(null);
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  if (queue.isPending) {
    return (
      <QueuePage title={t('disputes.title')} intro={t('disputes.intro')}>
        <SkeletonCard label={t('common:state.loading')} />
      </QueuePage>
    );
  }

  if (queue.isError) {
    return (
      <QueuePage title={t('disputes.title')} intro={t('disputes.intro')}>
        <ErrorState error={queue.error} onRetry={queue.refetch} />
      </QueuePage>
    );
  }

  const items = queue.data?.items ?? [];

  return (
    <QueuePage title={t('disputes.title')} intro={t('disputes.intro')}>
      {items.length === 0 ? (
        <EmptyState title={t('common.empty')} description={t('common.emptyBody')} />
      ) : null}

      {items.map((dispute) => (
        <Card key={dispute.disputeId}>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-subtitle text-ink">
                  {t('disputes.raisedBy')}: {dispute.raisedByParty}
                </h2>
                {dispute.record?.agreedAmount != null ? (
                  <p className="mt-0.5 font-mono text-small tnum text-ink">
                    {t('disputes.amount')}: {fmt.paisa(dispute.record.agreedAmount)}
                  </p>
                ) : null}
              </div>
              <Badge tone="neutral">{dispute.record?.status ?? 'disputed'}</Badge>
            </div>

            {/* Both accounts, in one glance. */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Position
                heading={t('disputes.familyPosition')}
                party="family"
                dispute={dispute}
                fmt={fmt}
                t={t}
              />
              <Position
                heading={t('disputes.tutorPosition')}
                party="tutor"
                dispute={dispute}
                fmt={fmt}
                t={t}
              />
            </div>

            {openId === dispute.disputeId ? (
              <ReasonForm
                busy={resolve.isPending}
                note={t('disputes.boundary')}
                options={OUTCOMES.map((outcome) => ({
                  value: outcome,
                  label: t(`payments:status.${outcome}`, { defaultValue: outcome }),
                  tone: outcome === 'settled' ? 'primary' : undefined,
                }))}
                onSubmit={(outcome, reason) =>
                  resolve.mutateAsync({ id: dispute.disputeId, outcome, reason })
                }
              />
            ) : (
              <Button variant="secondary" onClick={() => setOpenId(dispute.disputeId)}>
                {t('disputes.resolve')}
              </Button>
            )}
          </CardBody>
        </Card>
      ))}

      {/* SEC-23, stated on the screen where money is being discussed. */}
      {queue.data?.disclaimer ? (
        <p className="text-caption text-slate">{queue.data.disclaimer}</p>
      ) : null}
    </QueuePage>
  );
}
