/**
 * Button.
 *
 * ── Tap target is a floor, not a suggestion ────────────────────────────────
 * Every variant is at least 44px tall (`min-h-tap`) and primary is 48px. WCAG
 * 2.5.5 sets 44; this audience is on mid-range Android, often one-handed,
 * sometimes hurried, and the cost of a mis-tap on "Confirm booking" is a
 * booking somebody did not mean to make.
 *
 * ── `busy` rather than a spinner swap ──────────────────────────────────────
 * A button that replaces its label with a spinner tells a screen-reader user
 * nothing and loses the context sighted users had a moment ago. This keeps the
 * label, dims it, sets `aria-busy`, and disables the control — so the state is
 * announced and the meaning survives.
 */

import { forwardRef } from 'react';

/**
 * `active:scale-[0.98]` is the only motion on a button, and it is doing a job.
 *
 * On a phone the finger covers the control, so the hover state — the thing that
 * confirms a press on a desktop — is invisible at exactly the moment it is
 * needed. A 2% depression is visible around the fingertip and tells somebody on
 * a slow connection that the tap registered, which is when they would otherwise
 * tap again and submit twice.
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-control font-body font-medium ' +
  'transition-[colors,transform] duration-quick ease-enter select-none ' +
  'active:scale-[0.98] disabled:active:scale-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-55';

const VARIANTS = {
  /** The one action the screen exists for. One per view. */
  primary:
    'bg-ink text-white hover:bg-ink-deep active:bg-ink-deep min-h-tap-lg px-5 ' +
    'shadow-card disabled:hover:bg-ink',

  /** Everything else that acts. */
  secondary:
    'bg-white text-ink border border-slate-line hover:bg-paper active:bg-paper-sunk ' +
    'min-h-tap px-4',

  /** Verification, and actions that lead to it. Uses the AA-safe teal. */
  accent:
    'bg-verdigris text-white hover:bg-verdigris-deep active:bg-verdigris-deep min-h-tap px-4',

  /** Low-emphasis. Still a full tap target. */
  ghost: 'bg-transparent text-verdigris-deep hover:bg-verdigris-soft min-h-tap px-3',

  /**
   * Destructive. Brick rather than a bright red, and never the default focus of
   * a dialogue — the cancel is.
   */
  danger: 'bg-flag text-white hover:bg-[#8C2820] active:bg-[#8C2820] min-h-tap px-4',
};

const SIZES = {
  md: 'text-body',
  sm: 'text-small px-3 min-h-tap',
};

export const Button = forwardRef(function Button(
  {
    variant = 'secondary',
    size = 'md',
    busy = false,
    disabled = false,
    fullWidth = false,
    type = 'button',
    className = '',
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[
        BASE,
        VARIANTS[variant] ?? VARIANTS.secondary,
        SIZES[size] ?? SIZES.md,
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      <span className={busy ? 'opacity-80' : undefined}>{children}</span>
    </button>
  );
});

/**
 * The bottom action bar.
 *
 * Primary actions live within thumb reach on a phone, not at the top of a
 * scrolled page. Fixed to the bottom below `sm`, inline above it — a desktop
 * user has no thumb-reach problem and a fixed bar there only steals height.
 */
export function ActionBar({ children, className = '' }) {
  return (
    <div
      className={[
        'fixed inset-x-0 bottom-0 z-30 border-t border-slate-line bg-white/95 px-4 py-3 shadow-action-bar backdrop-blur',
        'pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
        'sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="mx-auto flex max-w-prose gap-3">{children}</div>
    </div>
  );
}
