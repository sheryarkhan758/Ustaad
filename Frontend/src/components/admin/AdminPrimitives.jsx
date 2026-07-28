/**
 * The pieces every administrator queue is built from — §6.14.
 *
 * ── Why this is a different interface from the rest of the product ─────────
 * Everything else here is built for somebody using it once: a parent choosing a
 * tutor, a tutor setting her rates. This is built for somebody who will be on
 * it for an hour, working a list. Those want opposite things. So: tables rather
 * than cards, information density over whitespace, one row per item, and **no
 * entrance animation anywhere in here** — a queue that fades in on every
 * refetch is a queue somebody has to wait for a hundred times an hour.
 *
 * The only motion is a 90ms row highlight on hover, which is pointer feedback
 * rather than decoration: it tells somebody scanning forty rows which one their
 * click will land on.
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

import { Page } from '../layout/Page';
import { Button } from '../ui/Button';
import { Field, Textarea } from '../ui/Field';

/** The minimum every `reasonSchema` on the server enforces. */
export const MIN_REASON = 15;

/* =========================================================================
 * Layout
 * ====================================================================== */

/**
 * A queue is a page, on the same frame as every other page.
 *
 * It used to define its own container, spacing and a `text-title` heading,
 * which made every administrator screen sit eight pixels higher than the rest
 * of the product with a smaller title on it. `wide` because a queue is scanned
 * in columns.
 */
export function QueuePage({ title, intro, children, actions = null }) {
  return (
    <Page width="wide" title={title} intro={intro} actions={actions}>
      {children}
    </Page>
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
            <tr key={row.id} className="border-b border-slate-line transition-colors duration-instant last:border-0 hover:bg-paper">
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
/**
 * A count that is also the way in — the dashboard's whole design.
 *
 * ── Three alignment properties, each of which was wrong ────────────────────
 * **The figures line up.** They sit on their own row, pushed to the bottom of
 * the tile by `mt-auto`, so twelve tiles read as one row of numbers rather than
 * twelve numbers at twelve heights. `h-full` makes every tile fill its grid
 * cell, so a two-line label does not make its tile shorter than its neighbours.
 *
 * **The figure does not move.** "Clear" used to appear under the number only
 * when it was zero, which shifted every zero tile's number up by a line
 * relative to the non-zero ones beside it. The caption row is now always
 * present and empty when there is nothing to say.
 *
 * **`tnum`** so `1` and `7` occupy the same width and a column of counts stays
 * a column while the numbers change under it.
 */
export function CountTile({ to, label, value, tone = 'neutral' }) {
  const { t } = useTranslation('admin');
  const urgent = tone === 'urgent' && value > 0;

  return (
    <Link
      to={to}
      className={[
        'flex h-full flex-col rounded-card border px-3 py-2.5',
        'transition-[colors,transform,box-shadow] duration-quick ease-enter',
        'hover:-translate-y-px hover:shadow-raised',
        urgent
          ? 'border-flag/40 bg-flag-soft hover:bg-flag-soft/70'
          : 'border-slate-line bg-white hover:bg-paper',
      ].join(' ')}
    >
      <span className="text-caption text-slate">{label}</span>

      <span
        className={[
          'mt-auto pt-2 font-mono text-title tnum tabular-nums',
          // `slate-light` measures 2.98:1 on white and is for icons and
          // placeholders, never for a figure somebody has to read.
          urgent ? 'text-flag' : value > 0 ? 'text-ink' : 'text-slate',
        ].join(' ')}
      >
        {value}
      </span>

      {/* Always rendered, so the figure above it sits at one height. */}
      <span className="min-h-[1rem] text-caption text-slate">
        {value === 0 ? t('dashboard.none') : ' '}
      </span>
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
