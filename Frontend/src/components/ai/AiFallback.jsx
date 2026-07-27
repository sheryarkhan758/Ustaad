/**
 * What every AI screen shows when the model cannot help — NFR-11, §7.4.
 *
 * ── The rule this component exists to keep ────────────────────────────────
 * *Every AI-dependent path has a working non-AI fallback.* Not a retry button,
 * not a spinner that eventually gives up — a **different route to the same
 * goal**. Someone who has just typed three paragraphs about their child
 * struggling with mathematics must never receive a stack trace, an error code,
 * or a dead end.
 *
 * The server already degrades: an exhausted budget, an unparseable response or
 * every provider being down all return a normal 200 with
 * `degradedToManualSearch: true` rather than a 5xx. This component is the
 * matching half — it says what happened in one sentence, does not apologise
 * twice, and puts the manual path directly under it.
 *
 * ── The link is on every screen, not only the broken one ──────────────────
 * `ManualSearchLink` renders unconditionally. A rate limit that arrives on
 * turn four should find the escape hatch already on the page rather than
 * requiring the interface to reveal one — and a parent who simply prefers a
 * search form should never have to finish a conversation to reach it.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Search, Warning } from '../ui/Icon';

/**
 * The escape hatch. Present on every AI screen, always.
 *
 * Deliberately not styled as a primary action — it is not the recommended
 * path, it is the always-available one.
 */
export function ManualSearchLink({ className = '' }) {
  const { t } = useTranslation('ai');

  return (
    <Link
      to="/search"
      className={[
        'inline-flex min-h-tap items-center gap-1.5 text-small font-medium text-verdigris-deep underline underline-offset-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Search size="sm" aria-hidden="true" />
      {t('fallback.manualSearch')}
    </Link>
  );
}

/**
 * The degraded state itself.
 *
 * @param {string} reasonKey Which of the three honest explanations applies:
 *   `busy` (budget or rate limit), `unclear` (unparseable response), or
 *   `insufficient` — which is **not a failure** but a valid terminal outcome
 *   (FR-10.8): the agent could not locate a gap from what it was told, and
 *   says so rather than inventing a confident answer.
 * @param {() => void} [onRetry] Offered only where retrying could plausibly
 *   work. A budget that is spent will still be spent in ten seconds.
 */
export function AiUnavailable({ reasonKey = 'busy', onRetry = null, children = null }) {
  const { t } = useTranslation(['ai', 'common']);

  return (
    <section
      // `status`, not `alert`. This is an outcome being reported, not an
      // emergency, and an assertive interruption would be the wrong register
      // for "we could not work it out from what you told us".
      role="status"
      aria-labelledby="ai-fallback-heading"
      className="rounded-control border border-slate-line bg-paper px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <Warning size="sm" className="mt-0.5 shrink-0 text-slate" aria-hidden="true" />

        <div className="min-w-0 flex-1 space-y-2">
          <h2 id="ai-fallback-heading" className="font-display text-subtitle text-ink">
            {t(`fallback.${reasonKey}.title`)}
          </h2>

          {/* One sentence on what happened. No apology, no error code. */}
          <p className="text-small text-ink">{t(`fallback.${reasonKey}.body`)}</p>

          {children}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                {t('common:action.retry')}
              </Button>
            ) : null}
            <ManualSearchLink />
          </div>
        </div>
      </div>
    </section>
  );
}
