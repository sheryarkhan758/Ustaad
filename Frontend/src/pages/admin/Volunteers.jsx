/**
 * The volunteer queue — §6.33, FR-33.10.
 *
 * ── The one thing this screen must not let anybody believe ─────────────────
 * Approving a volunteer creates a tutor account carrying the volunteer flag and
 * puts it in the verification queue. It does **not** verify anybody, does not
 * make anybody searchable, and publishes no badge.
 *
 * FR-33.10 calls that the load-bearing rule of the module, and the failure mode
 * is entirely human: an administrator who has read a good application, opened a
 * CV and clicked "approve" feels like they have vetted somebody. If the
 * interface lets that feeling stand, a volunteer reaches a family home on the
 * strength of goodwill — which is exactly the informal-market failure §2.3
 * describes, rebuilt inside the platform.
 *
 * So the warning sits above the button, in the alarm register, and says what
 * approving does and what it does not. The button's own label says it too.
 *
 * ── The password ──────────────────────────────────────────────────────────
 * Approval mints an account, so the administrator sets its first password. It
 * is typed here and posted once; nothing stores it in this component and
 * nothing echoes it back.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { VOLUNTEER_STATUSES } from '@shared/volunteers';

import { QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Warning } from '../../components/ui/Icon';
import { UserText } from '../../components/ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/** Statuses an administrator may set directly; `active` follows conversion. */
const REVIEWABLE = ['contacted', 'verified', 'declined', 'withdrawn'];

function Application({ application, onReviewed }) {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [password, setPassword] = useState('');

  const detail = useQuery({
    queryKey: ['admin', 'volunteer', application.id],
    queryFn: async () => api.get(`/volunteers/${application.id}`),
    enabled: open || approving,
  });

  const review = useMutation({
    mutationFn: ({ status, reviewNote }) =>
      api.post(`/volunteers/${application.id}/review`, { status, reviewNote }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      onReviewed();
      setOpen(false);
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const approve = useMutation({
    mutationFn: (reviewNote) =>
      api.post(`/volunteers/${application.id}/approve`, { password, reviewNote }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('volunteers.approved') });
      onReviewed();
      setApproving(false);
      setPassword('');
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-subtitle text-ink">{application.fullName}</h2>
            <p className="mt-0.5 text-caption text-slate">
              {application.email} · {application.phone} · {application.areaId} ·{' '}
              {t('volunteers.hours')}: {application.weeklyHours} · {fmt.date(application.createdAt)}
            </p>
          </div>
          <Badge tone="neutral">
            {t(`volunteers.statusLabel.${application.status}`, { defaultValue: application.status })}
          </Badge>
        </div>

        {application.motivation ? (
          <div>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {t('volunteers.motivation')}
            </h3>
            {/* Their own words, verbatim (§2.10). */}
            <UserText className="mt-0.5 text-small text-ink">{application.motivation}</UserText>
          </div>
        ) : null}

        {/* --- The document, by signed URL only (FR-33.4, SEC-24) -------- */}
        <div className="flex flex-wrap items-center gap-2">
          {detail.data?.documentUrl ? (
            <a
              href={detail.data.documentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-small font-medium text-verdigris-deep underline underline-offset-2"
            >
              {t('volunteers.openDocument')}
            </a>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
              {t('volunteers.document')}
            </Button>
          )}
          {detail.isSuccess && !detail.data?.documentUrl ? (
            <span className="text-caption text-flag">{t('volunteers.noDocument')}</span>
          ) : null}
          <span className="text-caption text-slate">{t('volunteers.documentNote')}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {t('volunteers.review')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setApproving((v) => !v)}>
            {t('volunteers.approve')}
          </Button>
        </div>

        {/* --- Move along the status path -------------------------------- */}
        {open ? (
          <ReasonForm
            busy={review.isPending}
            options={REVIEWABLE.map((status) => ({
              value: status,
              label: t(`volunteers.statusLabel.${status}`),
            }))}
            onSubmit={(status, reviewNote) => review.mutateAsync({ status, reviewNote })}
          />
        ) : null}

        {/* --- Approval, with what it is not stated first ---------------- */}
        {approving ? (
          <div className="space-y-3 rounded-control border border-seal/40 bg-seal-soft px-3 py-3">
            <div className="flex gap-2">
              <Warning size="sm" className="mt-0.5 shrink-0 text-seal-deep" aria-hidden="true" />
              <div>
                <h3 className="text-small font-semibold text-ink">
                  {t('volunteers.approveWarningTitle')}
                </h3>
                <p className="mt-0.5 text-caption text-ink">
                  {t('volunteers.approveWarningBody')}
                </p>
              </div>
            </div>

            <Field label={t('common:auth.password', { defaultValue: 'Password' })} htmlFor="v-password">
              {(props) => (
                <Input
                  {...props}
                  id="v-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>

            <ReasonForm
              busy={approve.isPending}
              options={[
                { value: 'approve', label: t('volunteers.approve'), tone: 'primary' },
              ]}
              onSubmit={(_value, reviewNote) => approve.mutateAsync(reviewNote)}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export default function AdminVolunteers() {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('received');

  const queue = useQuery({
    queryKey: ['admin', 'volunteers', status],
    queryFn: async () => (await api.get(`/volunteers?status=${status}`))?.applications ?? [],
  });

  return (
    <QueuePage title={t('volunteers.title')} intro={t('volunteers.intro')}>
      <Field label={t('common.status')} htmlFor="v-status">
        {(props) => (
          <Select
            {...props}
            id="v-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {VOLUNTEER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`volunteers.statusLabel.${value}`, { defaultValue: value })}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {queue.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
      {queue.isError ? <ErrorState error={queue.error} onRetry={queue.refetch} /> : null}

      {queue.isSuccess && (queue.data ?? []).length === 0 ? (
        <EmptyState title={t('common.empty')} description={t('common.emptyBody')} />
      ) : null}

      {(queue.data ?? []).map((application) => (
        <Application
          key={application.id}
          application={application}
          onReviewed={() => queryClient.invalidateQueries({ queryKey: ['admin'] })}
        />
      ))}
    </QueuePage>
  );
}
