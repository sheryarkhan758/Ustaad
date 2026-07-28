/**
 * The audit log viewer — §2.7, NFR-19, SEC-13.
 *
 * ── Read-only, and visibly so ──────────────────────────────────────────────
 * There is no edit control on this screen and no delete, because there is no
 * operation behind either: `server/services/audit.ts` exports an append and
 * three readers, and `admin_actions` is written by INSERT only. A correction is
 * a new entry that supersedes an old one, never an edit of it.
 *
 * The page states that. It matters that an administrator reading their own
 * recorded decision knows it cannot be quietly revised — that is the property
 * that makes the verification chain of custody in §6.6 mean anything, and a
 * viewer that looked editable would undercut it even while being read-only.
 *
 * ── What is not here ───────────────────────────────────────────────────────
 * No CNIC, no address, no token, no password — `appendAdminAction` refuses to
 * write those keys into `detail_json` on the way in (§2.2). The viewer prints
 * what was stored without a second, weaker copy of that rule.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { DataTable, QueuePage } from '../../components/admin/AdminPrimitives';
import { ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

export default function AdminAuditLog() {
  const { t } = useTranslation(['admin', 'common']);
  const fmt = useFormat();

  const [draft, setDraft] = useState({ adminUserId: '', action: '', targetType: '' });
  const [applied, setApplied] = useState({ adminUserId: '', action: '', targetType: '' });

  const query = new URLSearchParams(
    Object.entries(applied).filter(([, value]) => value !== ''),
  ).toString();

  const log = useQuery({
    queryKey: ['admin', 'audit', query],
    queryFn: async () => (await api.get(`/admin/audit${query ? `?${query}` : ''}`))?.entries ?? [],
  });

  const columns = [
    {
      key: 'createdAt',
      label: t('common.when'),
      render: (row) => (
        <span className="whitespace-nowrap font-mono text-caption tnum text-slate">
          {fmt.dateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'adminUserId',
      label: t('common.who'),
      render: (row) => <span className="font-mono text-caption">{row.adminUserId}</span>,
    },
    {
      key: 'action',
      label: t('common.action'),
      render: (row) => <span className="font-medium text-ink">{row.action}</span>,
    },
    {
      key: 'target',
      label: t('audit.target'),
      render: (row) => (
        <span className="text-caption text-slate">
          {row.targetType} · {row.targetId}
        </span>
      ),
    },
    {
      key: 'detail',
      label: t('audit.detail'),
      render: (row) =>
        row.detail ? (
          <span className="block max-w-md break-words font-mono text-caption text-slate">
            {JSON.stringify(row.detail)}
          </span>
        ) : null,
    },
  ];

  return (
    <QueuePage title={t('audit.title')} intro={t('audit.intro')}>
      {/* Stated once, plainly, where somebody might look for an edit button. */}
      <p className="rounded-control bg-paper-sunk px-3 py-2 text-caption text-ink">
        {t('audit.appendOnly')}
      </p>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
        }}
      >
        <Field label={t('audit.filterActor')} htmlFor="a-actor">
          {(props) => (
            <Input
              {...props}
              id="a-actor"
              value={draft.adminUserId}
              onChange={(event) => setDraft({ ...draft, adminUserId: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('audit.filterAction')} htmlFor="a-action">
          {(props) => (
            <Input
              {...props}
              id="a-action"
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            />
          )}
        </Field>
        <Field label={t('audit.filterTarget')} htmlFor="a-target">
          {(props) => (
            <Input
              {...props}
              id="a-target"
              value={draft.targetType}
              onChange={(event) => setDraft({ ...draft, targetType: event.target.value })}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary">
          {t('audit.apply')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const cleared = { adminUserId: '', action: '', targetType: '' };
            setDraft(cleared);
            setApplied(cleared);
          }}
        >
          {t('audit.clear')}
        </Button>
      </form>

      {log.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
      {log.isError ? <ErrorState error={log.error} onRetry={log.refetch} /> : null}

      {log.isSuccess ? (
        <DataTable
          caption={t('audit.caption')}
          columns={columns}
          rows={log.data ?? []}
          empty={t('audit.empty')}
        />
      ) : null}
    </QueuePage>
  );
}
