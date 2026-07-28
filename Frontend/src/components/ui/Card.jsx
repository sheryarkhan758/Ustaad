/**
 * Card, Badge, Table and the state components — the small vocabulary every
 * later screen is assembled from.
 */

/* -------------------------------------------------------------------------
 * Card
 * ---------------------------------------------------------------------- */

export function Card({ as: As = 'div', interactive = false, className = '', children, ...props }) {
  return (
    <As
      className={[
        'rounded-card border border-slate-line bg-white shadow-card',
        /*
          An interactive card lifts very slightly on hover — one pixel and a
          deeper shadow. Enough to read as "this is a control", not enough to
          reflow anything around it, and it is on `transform` and `box-shadow`
          so it stays on the compositor rather than triggering layout on a
          mid-range phone.

          A card that is not interactive does not move, because moving it would
          promise something it cannot do.
        */
        interactive
          ? 'transition-[colors,transform,box-shadow] duration-quick ease-enter hover:-translate-y-px hover:border-slate hover:shadow-raised focus-within:border-verdigris-deep'
          : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </As>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-3 border-b border-slate-line p-4 ${className}`}>
      <div className="min-w-0">
        <h3 className="truncate font-display text-subtitle text-ink">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-small text-slate">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className = '', children }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

/* -------------------------------------------------------------------------
 * Badge
 * ---------------------------------------------------------------------- */

/**
 * A small status marker.
 *
 * **This is not the verification badge.** Verification is a record card with
 * itemised checks and an attributed administrator — see
 * `components/verification/VerificationRecord.jsx`. A generic pill claiming
 * "Verified" is exactly what SEC-6 and FR-6.8 exist to prevent, so the tone
 * list below has no `verified` entry and never will.
 */
const TONES = {
  neutral: 'bg-paper-sunk text-ink border-slate-line',
  info: 'bg-verdigris-soft text-verdigris-deep border-verdigris/25',
  settled: 'bg-settled-soft text-settled border-settled/25',
  warning: 'bg-seal-soft text-seal-deep border-seal/30',
  flag: 'bg-flag-soft text-flag border-flag/25',
};

export function Badge({ tone = 'neutral', className = '', children, ...props }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-medium',
        TONES[tone] ?? TONES.neutral,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Table
 * ---------------------------------------------------------------------- */

/**
 * A data table that survives 320px.
 *
 * The wrapper scrolls horizontally rather than letting the page do it — a page
 * that scrolls sideways is a page where the primary action drifts off screen.
 * `tabIndex={0}` makes the scroll region reachable by keyboard, which an
 * overflow container is not by default.
 */
export function Table({ caption, children, className = '' }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={caption}
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      {/* `text-start`, so column order and alignment follow the document
          direction. In RTL the first column is on the right, which is where an
          Urdu reader looks first — the browser handles that for a <table> once
          the alignment is logical rather than physical. */}
      <table className={`w-full min-w-[32rem] border-collapse text-start ${className}`}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Th({ numeric = false, className = '', children, ...props }) {
  return (
    <th
      scope="col"
      className={[
        'border-b border-slate-line pb-2 pe-4 text-caption font-semibold uppercase tracking-wide text-slate',
        // A numeric column aligns to the *end* edge in both directions, so the
        // digits still form a right-hand column of units in LTR and a
        // left-hand one in RTL — either way the decimal places line up.
        numeric ? 'text-end' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({ numeric = false, className = '', children, ...props }) {
  return (
    <td
      className={[
        'border-b border-slate-line py-3 pe-4 text-small text-ink align-top',
        // Amounts line up in a column, which is the entire reason to put them
        // in a table rather than a list.
        numeric ? 'text-end tnum font-mono' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------
 * Empty, error and loading states
 * ---------------------------------------------------------------------- */

/**
 * Nothing here — and why, and what to do about it.
 *
 * An empty state that says only "No results" blames the user for a query that
 * may have been perfectly reasonable. `action` is not optional in practice:
 * every empty state in this product should offer the next move.
 */
export function EmptyState({ title, description, action, icon = null }) {
  return (
    <div className="flex animate-fade-in flex-col items-center gap-3 rounded-card border border-dashed border-slate-line bg-white/60 px-6 py-10 text-center">
      {icon ? <div className="text-slate-light">{icon}</div> : null}
      <h3 className="font-display text-subtitle text-ink">{title}</h3>
      {description ? <p className="max-w-prose text-small text-slate">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Something failed.
 *
 * Renders the server's own `message` when there is one — the API writes those
 * for a person and they are safe to display. Inventing our own copy for a case
 * the server already worded produces two different explanations of one failure.
 */
export function ErrorState({ title = 'That did not work', error, onRetry }) {
  const message =
    error?.message ?? 'Something went wrong at our end. Nothing you entered has been lost.';

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-flag/30 bg-flag-soft px-5 py-4"
    >
      <div>
        <h3 className="font-display text-subtitle text-flag">{title}</h3>
        <p className="mt-1 text-small text-ink">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-tap rounded-control border border-flag/40 bg-white px-4 text-small font-medium text-flag hover:bg-flag-soft"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Skeleton loader.
 *
 * The shimmer is a single `background-position` animation, and the reduced-
 * motion rule in `index.css` flattens it to a static block — a repeating
 * horizontal sweep is exactly the pattern that triggers vestibular symptoms.
 *
 * `aria-hidden` with a live-region label on the container: a screen reader
 * should hear "Loading", once, not read eight grey rectangles.
 */
export function Skeleton({ className = '', ...props }) {
  return (
    <div
      aria-hidden="true"
      className={[
        'animate-shimmer rounded bg-[linear-gradient(90deg,theme(colors.paper.sunk)_25%,theme(colors.paper.DEFAULT)_50%,theme(colors.paper.sunk)_75%)] bg-[length:200%_100%]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export function SkeletonCard({ label = 'Loading' }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <Card className="p-4">
        <div className="flex gap-3">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </Card>
    </div>
  );
}
