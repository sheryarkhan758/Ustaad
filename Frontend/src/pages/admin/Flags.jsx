/**
 * The report queue — §6.14, FR-14.1, FR-14.2.
 *
 * One row per open report, and a resolution that cannot be recorded without a
 * written reason. The reason is not a formality: `admin_actions` is append-only
 * (§2.7, NFR-19), so what is typed here is the permanent account of why a
 * report about a named person was actioned or dismissed, and it is the only
 * account there will be.
 *
 * The reporter is shown to the administrator and to nobody else. FR-9.8 and
 * SEC-26 keep a reporter's identity away from the person reported on, which is
 * what makes reporting possible at all.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DataTable, QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

export default function AdminFlags() {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState(null);

  const queue = useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: async () => (await api.get('/admin/flags'))?.items ?? [],
  });

  const resolve = useMutation({
    mutationFn: ({ id, decision, reason }) =>
      api.post(`/admin/flags/${id}/resolve`, { decision, reason }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      setOpenId(null);
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  if (queue.isPending) {
    return (
      <QueuePage title={t('flags.title')}>
        <SkeletonCard label={t('common:state.loading')} />
      </QueuePage>
    );
  }

  if (queue.isError) {
    return (
      <QueuePage title={t('flags.title')}>
        <ErrorState error={queue.error} onRetry={queue.refetch} />
      </QueuePage>
    );
  }

  const rows = (queue.data ?? []).map((row) => ({ ...row, id: row.id ?? row.flagId }));

  const columns = [
    {
      key: 'targetType',
      label: t('flags.target'),
      render: (row) => (
        <span className="text-ink">
          {row.targetType} · <span className="text-caption text-slate">{row.targetId}</span>
        </span>
      ),
    },
    { key: 'reason', label: t('flags.reason') },
    {
      key: 'reporterUserId',
      label: t('flags.reporter'),
      render: (row) => <span className="text-caption text-slate">{row.reporterUserId ?? '—'}</span>,
    },
    {
      key: 'createdAt',
      label: t('common.when'),
      render: (row) => fmt.date(row.createdAt),
    },
    {
      key: 'status',
      label: t('common.status'),
      render: (row) => <Badge tone="neutral">{row.status}</Badge>,
    },
    {
      key: 'act',
      label: t('common.action'),
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => setOpenId(row.id)}>
          {t('flags.resolve')}
        </Button>
      ),
    },
  ];

  return (
    <QueuePage title={t('flags.title')}>
      <DataTable caption={t('flags.title')} columns={columns} rows={rows} />

      {openId ? (
        <Card>
          <CardBody className="space-y-3">
            <h2 className="font-display text-subtitle text-ink">{t('flags.resolveTitle')}</h2>
            <ReasonForm
              busy={resolve.isPending}
              options={[
                { value: 'actioned', label: t('flags.actioned'), tone: 'primary' },
                { value: 'dismissed', label: t('flags.dismissed') },
              ]}
              onSubmit={(decision, reason) =>
                resolve.mutateAsync({ id: openId, decision, reason })
              }
            />
          </CardBody>
        </Card>
      ) : null}
    </QueuePage>
  );
}
