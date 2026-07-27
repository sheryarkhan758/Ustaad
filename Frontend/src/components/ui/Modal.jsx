/**
 * Modal and Toast.
 *
 * ── The modal is a real dialogue ───────────────────────────────────────────
 * Built on `<dialog showModal()>`, which gives focus trapping, inert background
 * content, Escape-to-close and the top layer from the platform rather than from
 * four hundred lines of our own focus management. Every one of those is a thing
 * hand-rolled modals get wrong.
 *
 * On a phone it presents as a bottom sheet — anchored to the thumb, not
 * floating in the middle of a screen the user cannot reach the top of.
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * `placement="side"` — a slide-over rather than a centred card.
 *
 * Still the same `<dialog showModal()>`, and deliberately so: the focus trap,
 * the inert background, Escape-to-close and the top layer are the platform's
 * and are the four things a hand-rolled panel gets wrong. Only the box changes.
 *
 * It exists for the feedback channel (§6.32), which has to be reachable from
 * every page without leaving it. A full-height panel down one edge keeps more
 * of the page the user is reporting on visible behind it than a centred card
 * does — and on a phone it stays a bottom sheet, because a side panel on a
 * 360px screen is just a modal with extra steps.
 */
export function Modal({ open, onClose, title, description, children, footer, placement = 'center' }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape fires `cancel`, and the parent owns `open`, so the state has to come
  // back rather than the dialog closing itself behind React's back.
  const handleCancel = useCallback(
    (event) => {
      event.preventDefault();
      onClose?.();
    },
    [onClose],
  );

  return (
    <dialog
      ref={ref}
      onCancel={handleCancel}
      onClick={(event) => {
        // Clicking the backdrop closes. The backdrop is the dialog element
        // itself — anything inside stops the event before it reaches here.
        if (event.target === ref.current) onClose?.();
      }}
      aria-labelledby="modal-title"
      aria-describedby={description ? 'modal-description' : undefined}
      className={[
        'w-full max-w-prose rounded-t-card border border-slate-line bg-white p-0 text-ink shadow-raised',
        'backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]',
        // Bottom sheet on a phone, either way.
        'mb-0 mt-auto',
        placement === 'side'
          ? // Full height against the inline-end edge — `me-0` rather than
            // `mr-0`, so it lands on the correct side in the Urdu view.
            'sm:my-0 sm:me-0 sm:ms-auto sm:h-full sm:max-h-full sm:rounded-none sm:rounded-s-card'
          : 'sm:my-auto sm:rounded-card',
      ].join(' ')}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-line p-4">
          <div className="min-w-0">
            <h2 id="modal-title" className="font-display text-title text-ink">
              {title}
            </h2>
            {description ? (
              <p id="modal-description" className="mt-1 text-small text-slate">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 flex h-tap w-tap shrink-0 items-center justify-center rounded-control text-slate hover:bg-paper hover:text-ink"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              ×
            </span>
          </button>
        </div>

        <div
          className={[
            'overflow-y-auto p-4',
            placement === 'side' ? 'max-h-[65vh] sm:max-h-[calc(100vh-13rem)]' : 'max-h-[65vh]',
          ].join(' ')}
        >
          {children}
        </div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-slate-line p-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

/* -------------------------------------------------------------------------
 * Toast
 * ---------------------------------------------------------------------- */

const TOAST_TONES = {
  info: 'border-verdigris/30 bg-verdigris-soft text-verdigris-deep',
  settled: 'border-settled/30 bg-settled-soft text-settled',
  flag: 'border-flag/30 bg-flag-soft text-flag',
};

/**
 * A transient message.
 *
 * `role="status"` and `aria-live="polite"` — never `alert`, which interrupts a
 * screen reader mid-sentence. A confirmation is not worth cutting somebody off
 * for; a genuine error belongs in `ErrorState`, in the page, where it persists.
 *
 * **Toasts carry no action.** A control that vanishes on a timer is a control
 * a slow reader cannot use, and "Undo" is precisely the thing someone reaches
 * for late.
 */
export function Toast({ tone = 'info', title, description, onDismiss }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'pointer-events-auto flex w-full max-w-prose items-start gap-3 rounded-card border px-4 py-3 shadow-raised',
        TOAST_TONES[tone] ?? TOAST_TONES.info,
      ].join(' ')}
    >
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold">{title}</p>
        {description ? <p className="mt-0.5 text-caption opacity-90">{description}</p> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-2 flex h-tap w-tap shrink-0 items-center justify-center rounded-control opacity-70 hover:opacity-100"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

/** Bottom-anchored above the action bar, so it never covers the primary action. */
export function ToastRegion({ children }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(theme(spacing.action-bar)+0.5rem)] z-40 flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {children}
    </div>
  );
}
