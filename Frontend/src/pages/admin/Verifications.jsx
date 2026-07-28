/**
 * The verification queue — §6.6, FR-6.5 to FR-6.9. The most consequential
 * screen in the product.
 *
 * ── The badge is generated, never written ──────────────────────────────────
 * The platform's entire claim is "an administrator checked these documents, on
 * this date, and here is who they were". A free-text badge field would let that
 * claim say anything — including the words SEC-6 forbids outright, and
 * including a claim about a check nobody performed.
 *
 * So there is no such field. The administrator ticks what they actually opened,
 * and `buildBadges` — **the same function the public profile renders from**,
 * imported from `/shared` — turns those ticks into badge text. The preview is
 * not a mock-up of the public badge; it is the public badge, from the same call
 * on the same input.
 *
 * The guard is visible too: anything `buildBadges` refuses is listed as
 * withheld rather than silently dropped, so an administrator sees that a badge
 * was refused instead of wondering where it went.
 *
 * ── Opening a document is an act, not a page load ──────────────────────────
 * Documents arrive as metadata only. The URL is minted per view, expires, and
 * is logged against the administrator **before** it is issued (SEC-7, NFR-9) —
 * a failure to log is a failure to disclose. The screen says so next to the
 * button, because somebody about to open a stranger's CNIC should know that the
 * opening is recorded.
 *
 * ── Reasons rather than confirmations ──────────────────────────────────────
 * Approve, reject and request-more all go through `ReasonForm`. Fifteen
 * characters cannot be typed by accident, which makes it a better guard than
 * "are you sure?" — and unlike a confirmation, the answer is still there in the
 * log a month later when somebody asks why.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildBadges, VERIFIABLE_ARTEFACTS } from '@shared/badges';

import { DataTable, QueuePage, ReasonForm } from '../../components/admin/AdminPrimitives';
import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Warning } from '../../components/ui/Icon';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/* =========================================================================
 * The queue
 * ====================================================================== */

function Queue() {
  const { t } = useTranslation(['admin', 'common', 'search']);
  const fmt = useFormat();

  const queue = useQuery({
    queryKey: ['admin', 'verifications'],
    queryFn: async () => (await api.get('/admin/verifications'))?.items ?? [],
  });

  if (queue.isPending) return <SkeletonCard label={t('common:state.loading')} />;
  if (queue.isError) return <ErrorState error={queue.error} onRetry={queue.refetch} />;

  const columns = [
    {
      key: 'slug',
      label: t('verification.tutor'),
      render: (row) => (
        <Link
          to={`/admin/verifications/${row.tutorId}`}
          className="font-medium text-verdigris-deep underline underline-offset-2"
        >
          {row.slug}
        </Link>
      ),
    },
    { key: 'cityId', label: t('search:filters.city') },
    {
      key: 'profileStatus',
      label: t('common.status'),
      render: (row) => <Badge tone="neutral">{row.profileStatus}</Badge>,
    },
    {
      key: 'submittedAt',
      label: t('verification.submitted'),
      render: (row) => fmt.date(row.submittedAt),
    },
    {
      key: 'duplicateCnicFlagged',
      label: 'CNIC',
      render: (row) =>
        row.duplicateCnicFlagged ? (
          <span className="inline-flex items-center gap-1 text-caption font-medium text-flag">
            <Warning size="sm" aria-hidden="true" />
            duplicate
          </span>
        ) : null,
    },
  ];

  return (
    <DataTable
      caption={t('verification.queueCaption')}
      columns={columns}
      rows={(queue.data ?? []).map((row) => ({ ...row, id: row.tutorId }))}
    />
  );
}

/* =========================================================================
 * The badge preview — what the public will see
 * ====================================================================== */

function BadgePreview({ artefactsChecked }) {
  const { t } = useTranslation('admin');

  // The same call the public profile makes. Not a rendering of what it might
  // say — the thing itself.
  const result = buildBadges({ artefactsChecked });

  return (
    <div className="rounded-control border border-verdigris/30 bg-verdigris-soft/40 px-3 py-2.5">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
        {t('verification.preview')}
      </h3>

      {result.badges.length === 0 ? (
        <p className="mt-1.5 text-caption text-slate">{t('verification.previewEmpty')}</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {result.badges.map((badge) => (
            <li key={badge.text}>
              <Badge tone="info">{badge.text}</Badge>
            </li>
          ))}
        </ul>
      )}

      {/* A refusal is shown, not swallowed. */}
      {result.rejected.length > 0 ? (
        <p className="mt-2 text-caption text-flag">
          {t('verification.withheld')}: {result.rejected.map((r) => r.matchedTerm).join(', ')}
        </p>
      ) : null}

      {/* SEC-6 — printed on every profile at the same size as the badges. */}
      <p className="mt-2 text-caption text-ink">
        {t('verification.scopeNote')} “{result.scopeNote.en}”
      </p>

      <p className="mt-1.5 text-caption text-slate">{t('verification.previewHint')}</p>
    </div>
  );
}

/* =========================================================================
 * One tutor's dossier
 * ====================================================================== */

function Dossier({ tutorId }) {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [checked, setChecked] = useState([]);
  const [missing, setMissing] = useState([]);

  const dossier = useQuery({
    queryKey: ['admin', 'verification', tutorId],
    queryFn: async () => api.get(`/admin/verifications/${tutorId}`),
  });

  const openDocument = useMutation({
    mutationFn: (documentId) =>
      api.post(`/admin/verifications/${tutorId}/documents/${documentId}/view`, {
        purpose: 'identity_verification',
      }),
    onSuccess: (data) => {
      // A new tab rather than an inline viewer: the URL expires, and a stale
      // iframe silently showing nothing is worse than a tab that failed.
      globalThis.open?.(data.url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const decide = useMutation({
    mutationFn: ({ decision, reason }) => {
      if (decision === 'approve') {
        return api.post(`/admin/verifications/${tutorId}/approve`, {
          artefactsChecked: checked,
          reason,
        });
      }
      if (decision === 'reject') {
        return api.post(`/admin/verifications/${tutorId}/reject`, {
          artefactsChecked: checked,
          reason,
        });
      }
      return api.post(`/admin/verifications/${tutorId}/request-info`, {
        missingArtefacts: missing,
        reason,
      });
    },
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('common.recorded') });
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      setChecked([]);
      setMissing([]);
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  if (dossier.isPending) return <SkeletonCard label={t('common:state.loading')} />;
  if (dossier.isError) return <ErrorState error={dossier.error} onRetry={dossier.refetch} />;

  const { documents = [], history = [], auditTrail = [] } = dossier.data ?? {};

  const toggle = (list, setList, value) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="space-y-4">
      <p className="text-small">
        <Link to="/admin/verifications" className="text-verdigris-deep underline underline-offset-2">
          {t('common.back')}
        </Link>
      </p>

      {/* --- Documents -------------------------------------------------- */}
      <Card>
        <CardBody className="space-y-2">
          <h2 className="font-display text-subtitle text-ink">{t('verification.documents')}</h2>
          {documents.length === 0 ? (
            <p className="text-caption text-slate">{t('common.empty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {documents.map((document) => (
                <li key={document.id} className="flex flex-wrap items-center gap-2 text-small">
                  <span className="text-ink">
                    {t(`verification.artefact.${document.docType}`, {
                      defaultValue: document.docType,
                    })}
                  </span>
                  <span className="text-caption text-slate">{fmt.date(document.uploadedAt)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={openDocument.isPending && openDocument.variables === document.id}
                    onClick={() => openDocument.mutate(document.id)}
                  >
                    {t('verification.openDocument')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {/* Said where the button is. */}
          <p className="text-caption text-slate">{t('verification.documentNote')}</p>
        </CardBody>
      </Card>

      {/* --- The checklist, and what it produces ------------------------ */}
      <Card>
        <CardBody className="space-y-3">
          <div>
            <h2 className="font-display text-subtitle text-ink">{t('verification.checklist')}</h2>
            <p className="mt-0.5 text-caption text-slate">{t('verification.checklistHint')}</p>
          </div>

          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('verification.checklist')}</legend>
            {VERIFIABLE_ARTEFACTS.map((artefact) => (
              <label
                key={artefact}
                className={[
                  'flex min-h-tap cursor-pointer items-center gap-2 rounded-control border px-3 text-small',
                  checked.includes(artefact)
                    ? 'border-verdigris bg-verdigris-soft/40 text-ink'
                    : 'border-slate-line text-slate hover:bg-paper-sunk',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={checked.includes(artefact)}
                  onChange={() => toggle(checked, setChecked, artefact)}
                  className="h-4 w-4 accent-verdigris-deep"
                />
                {t(`verification.artefact.${artefact}`)}
              </label>
            ))}
          </fieldset>

          <BadgePreview artefactsChecked={checked} />
        </CardBody>
      </Card>

      {/* --- The decision ----------------------------------------------- */}
      <Card>
        <CardBody>
          <ReasonForm
            busy={decide.isPending}
            note={
              checked.length === 0
                ? t('verification.noneChecked')
                : `${t('verification.approveNote')} ${t('verification.rejectNote')}`
            }
            options={[
              { value: 'approve', label: t('verification.approve'), tone: 'primary' },
              { value: 'reject', label: t('verification.reject') },
              { value: 'request_info', label: t('verification.requestInfo') },
            ]}
            onSubmit={(decision, reason) => decide.mutateAsync({ decision, reason })}
          >
            {/*
              Only relevant to request-more, and shown here rather than behind a
              mode switch: by the time somebody is typing a reason they have
              already decided which button they are heading for, and a switch
              would make them say it twice.
            */}
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="w-full text-caption text-slate">
                {t('verification.missingArtefacts')}
              </legend>
              {VERIFIABLE_ARTEFACTS.map((artefact) => (
                <label key={artefact} className="flex items-center gap-1.5 text-caption text-ink">
                  <input
                    type="checkbox"
                    checked={missing.includes(artefact)}
                    onChange={() => toggle(missing, setMissing, artefact)}
                    className="h-4 w-4 accent-verdigris-deep"
                  />
                  {t(`verification.artefact.${artefact}`)}
                </label>
              ))}
            </fieldset>
          </ReasonForm>
        </CardBody>
      </Card>

      {/* --- What is already on the record ------------------------------ */}
      <Card>
        <CardBody className="space-y-2">
          <h2 className="font-display text-subtitle text-ink">{t('verification.auditTrail')}</h2>
          {history.length === 0 && auditTrail.length === 0 ? (
            <p className="text-caption text-slate">{t('common.empty')}</p>
          ) : (
            <ul className="space-y-1.5 text-caption">
              {history.map((record) => (
                <li key={record.id} className="text-ink">
                  <span className="font-medium">{record.decision}</span> ·{' '}
                  {(record.artefactsChecked ?? []).join(' + ') || '—'} ·{' '}
                  {fmt.date(record.decidedAt)} — {record.reason}
                </li>
              ))}
              {auditTrail.map((entry) => (
                <li key={entry.id} className="text-slate">
                  {entry.action} · {fmt.dateTime(entry.createdAt)}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default function AdminVerifications() {
  const { t } = useTranslation('admin');
  const { tutorId } = useParams();

  return (
    <QueuePage title={t('verification.title')} intro={t('verification.intro')}>
      {tutorId ? <Dossier tutorId={tutorId} /> : <Queue />}
    </QueuePage>
  );
}
