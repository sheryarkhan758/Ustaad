/**
 * Feedback triage — §6.32, FR-32.7, FR-32.8.
 *
 * ── Safety concerns are pinned, and look different ─────────────────────────
 * FR-32.8 escalates a safety concern in the queue. "Escalated" is only real if
 * an administrator working from the top of a list reaches it first, so those
 * items are fetched separately, sit above everything, and are tinted. A sort
 * order alone would leave them looking identical to a report about a broken
 * layout.
 *
 * They are never public and never shown to the tutor concerned in a form that
 * identifies the reporter (SEC-26). Nothing on this screen offers to forward
 * one, because there is no endpoint that would.
 *
 * ── The disposition note is internal, and is labelled as internal ──────────
 * A triage note is written for the next administrator, not for the person who
 * reported. Saying so on the field is what keeps it candid: somebody who thinks
 * their note will be read by the reporter writes a different, less useful note.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@shared/feedback';

import { QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Field';
import { Warning } from '../../components/ui/Icon';
import { UserText } from '../../components/ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/** What triage may move an item to. `new` is where it starts. */
const DISPOSITIONS = ['triaged', 'actioned', 'declined'];

function FeedbackRow({ item, onTriage, busy, safety = false }) {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();
  const [open, setOpen] = useState(false);

  return (
    <Card className={safety ? 'border-flag/40' : undefined}>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {safety ? (
                <Warning size="sm" className="text-flag" aria-hidden="true" />
              ) : null}
              <Badge tone={safety ? 'flag' : 'neutral'}>
                {t(`feedback.categoryLabel.${item.category}`, { defaultValue: item.category })}
              </Badge>
              <Badge tone="neutral">
                {t(`feedback.status.${item.status}`, { defaultValue: item.status })}
              </Badge>
              {item.satisfactionRating ? (
                <span className="font-mono text-caption tnum text-slate">
                  {item.satisfactionRating}/5
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-caption text-slate">
              {item.pagePath ?? '—'} · {item.locale ?? '—'} · {item.role ?? 'anonymous'} ·{' '}
              {item.appVersion ?? '—'} · {fmt.date(item.createdAt)}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {t('feedback.triage')}
          </Button>
        </div>

        {/* The reporter's own words, unchanged and never translated (§2.10). */}
        <UserText className="text-small text-ink">{item.detail}</UserText>

        {open ? (
          <ReasonForm
            busy={busy}
            note={t('feedback.dispositionHint')}
            options={DISPOSITIONS.map((status) => ({
              value: status,
              label: t(`feedback.status.${status}`),
              tone: status === 'actioned' ? 'primary' : undefined,
            }))}
            onSubmit={(status, dispositionNote) =>
              onTriage({ id: item.id, status, dispositionNote }).then(() => setOpen(false))
            }
          />
        ) : null}
      </CardBody>
    </Card>
  );
}

export default function AdminFeedback() {
  const { t } = useTranslation(['admin', 'common']);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');

  /* Safety concerns are their own request, so they cannot be filtered away. */
  const safety = useQuery({
    queryKey: ['admin', 'feedback', 'safety'],
    queryFn: async () => (await api.get('/feedback/queue?safetyOnly=true'))?.items ?? [],
  });

  const queue = useQuery({
    queryKey: ['admin', 'feedback', status],
    queryFn: async () =>
      (await api.get(`/feedback/queue${status ? `?status=${status}` : ''}`))?.items ?? [],
  });

  const triage = useMutation({
    mutationFn: ({ id, status: next, dispositionNote }) =>
      api.post(`/feedback/${id}/triage`, { status: next, dispositionNote }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      queryClient.invalidateQueries({ queryKey: ['admin', 'feedback'] });
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const byCategory = (items) =>
    category ? items.filter((item) => item.category === category) : items;

  const safetyIds = new Set((safety.data ?? []).map((item) => item.id));
  const rest = byCategory(queue.data ?? []).filter((item) => !safetyIds.has(item.id));

  return (
    <QueuePage title={t('feedback.title')} intro={t('feedback.intro')}>
      {/* --- Filters ---------------------------------------------------- */}
      <div className="flex flex-wrap gap-3">
        <Field label={t('feedback.filterStatus')} htmlFor="f-status">
          {(props) => (
            <Select
              {...props}
              id="f-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t('feedback.all')}</option>
              {FEEDBACK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`feedback.status.${value}`, { defaultValue: value })}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t('feedback.filterCategory')} htmlFor="f-category">
          {(props) => (
            <Select
              {...props}
              id="f-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{t('feedback.all')}</option>
              {FEEDBACK_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`feedback.categoryLabel.${value}`, { defaultValue: value })}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {/* --- Safety concerns, above everything -------------------------- */}
      {(safety.data ?? []).length > 0 ? (
        <section aria-labelledby="safety-heading" className="space-y-2">
          <h2 id="safety-heading" className="font-display text-subtitle text-flag">
            {t('feedback.safetyPinned')}
          </h2>
          <p className="text-caption text-slate">{t('feedback.safetyNote')}</p>
          {byCategory(safety.data ?? []).map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              safety
              busy={triage.isPending}
              onTriage={(input) => triage.mutateAsync(input)}
            />
          ))}
        </section>
      ) : null}

      {/* --- Everything else -------------------------------------------- */}
      {queue.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
      {queue.isError ? <ErrorState error={queue.error} onRetry={queue.refetch} /> : null}

      {queue.isSuccess && rest.length === 0 ? (
        <EmptyState title={t('common.empty')} description={t('common.emptyBody')} />
      ) : null}

      <section className="space-y-2">
        {rest.map((item) => (
          <FeedbackRow
            key={item.id}
            item={item}
            busy={triage.isPending}
            onTriage={(input) => triage.mutateAsync(input)}
          />
        ))}
      </section>
    </QueuePage>
  );
}
