/**
 * The pieces every administrator queue is built from — §6.14.
 *
 * ── Why this is a different interface from the rest of the product ─────────
 * Everything else here is built for somebody using it once: a parent choosing a
 * tutor, a tutor setting her rates. This is built for somebody who will be on
 * it for an hour, working a list. Those want opposite things. So: tables rather
 * than cards, information density over whitespace, one row per item, and no
 * animation between states.
 *
 * ── Every decision carries a reason, and the reason is the confirmation ────
 * A confirmation dialogue asks "are you sure?", which is answered by clicking
 * again and teaches nothing. `ReasonForm` asks *why*, refuses to submit without
 * an answer, and writes that answer to the append-only log (§2.7). It is a
 * better guard against the accidental click — you cannot type fifteen
 * characters by accident — and it produces the record that makes the decision
 * reviewable afterwards.
 *
 * That is why there is no `<ConfirmDialog>` in this file.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Field, Textarea } from '../ui/Field';

/** The minimum every `reasonSchema` on the server enforces. */
export const MIN_REASON = 15;

/* =========================================================================
 * Layout
 * ====================================================================== */

export function QueuePage({ title, intro, children, actions = null }) {
  return (
    <div className="mx-auto max-w-wide space-y-4 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-title text-ink">{title}</h1>
          {intro ? <p className="mt-1 max-w-prose text-small text-slate">{intro}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/**
 * A dense table.
 *
 * `caption` is not decoration: it is what a screen reader announces before the
 * rows, and an operations tool with four similar tables on four routes is
 * exactly where that matters.
 */
export function DataTable({ caption, columns, rows, empty }) {
  const { t } = useTranslation('admin');

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-slate-line bg-white px-4 py-6 text-center">
        <p className="text-small font-medium text-ink">{empty ?? t('common.empty')}</p>
        <p className="mt-1 text-caption text-slate">{t('common.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-slate-line bg-white">
      <table className="w-full border-collapse text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-line bg-paper-sunk text-start">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-3 py-2 text-start text-caption font-semibold uppercase tracking-wide text-slate"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-line last:border-0 hover:bg-paper">
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 align-top text-ink">
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A count that is also the way in — the dashboard's whole design. */
export function CountTile({ to, label, value, tone = 'neutral' }) {
  const { t } = useTranslation('admin');
  const urgent = tone === 'urgent' && value > 0;

  return (
    <Link
      to={to}
      className={[
        'flex flex-col rounded-card border px-3 py-2.5 transition-colors',
        urgent
          ? 'border-flag/40 bg-flag-soft hover:bg-flag-soft/70'
          : 'border-slate-line bg-white hover:bg-paper',
      ].join(' ')}
    >
      <span className="text-caption text-slate">{label}</span>
      <span
        className={[
          'mt-0.5 font-mono text-title tnum',
          // `slate-light` measures 2.98:1 on white and is for icons and
          // placeholders, never for a figure somebody has to read.
          urgent ? 'text-flag' : value > 0 ? 'text-ink' : 'text-slate',
        ].join(' ')}
      >
        {value}
      </span>
      {value === 0 ? <span className="text-caption text-slate">{t('dashboard.none')}</span> : null}
    </Link>
  );
}

/* =========================================================================
 * The decision form
 * ====================================================================== */

/**
 * An action that cannot be taken without saying why.
 *
 * @param {object[]} options One button each: `{ value, label, tone }`.
 * @param {(value: string, reason: string) => Promise<unknown>} onSubmit
 * @param {React.ReactNode} [children] Anything the decision also needs — the
 *   artefact checklist, a missing-document picker.
 */
export function ReasonForm({ options, onSubmit, busy = false, note = null, children = null }) {
  const { t } = useTranslation('admin');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  async function choose(value) {
    if (reason.trim().length < MIN_REASON) {
      setError(t('common.reasonMissing'));
      return;
    }
    setError(null);
    await onSubmit(value, reason.trim());
    setReason('');
  }

  return (
    <div className="space-y-3">
      {children}

      <Field label={t('common.reason')} hint={t('common.reasonHint')} error={error} htmlFor="reason">
        {(props) => (
          <Textarea
            {...props}
            id="reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2000}
          />
        )}
      </Field>

      {note ? <p className="text-caption text-slate">{note}</p> : null}

      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={option.tone === 'primary' ? 'accent' : 'secondary'}
            busy={busy}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
