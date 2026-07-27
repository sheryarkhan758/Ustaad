/**
 * Form controls: Input, Select, Textarea, and the Field wrapper around them.
 *
 * ── The label is not optional ──────────────────────────────────────────────
 * Every control here requires a `label`. A placeholder is not a label: it
 * disappears the moment someone types, so a person who is interrupted mid-form
 * — which is most people, on a phone — loses the question they were answering.
 *
 * ── Errors are wired, not just coloured ────────────────────────────────────
 * An error message is bound through `aria-describedby` and `aria-invalid`, and
 * announced with `role="alert"`. Colour alone fails anyone who cannot see it,
 * and this form asks for a date of birth and a CNIC — fields where a silent
 * failure means a person cannot register at all.
 *
 * ── 16px minimum on inputs ─────────────────────────────────────────────────
 * iOS Safari zooms the viewport when a focused input is under 16px. On a
 * booking form that throws the layout sideways mid-entry, so `text-body`
 * (1rem) is the floor for every control regardless of visual density.
 */

import { forwardRef, useId } from 'react';

const CONTROL =
  'w-full rounded-control border bg-white px-3 text-body text-ink min-h-tap ' +
  'placeholder:text-slate-light transition-colors ' +
  'disabled:cursor-not-allowed disabled:bg-paper disabled:text-slate';

function controlClasses(invalid, extra = '') {
  return [
    CONTROL,
    invalid
      ? 'border-flag focus:border-flag'
      : 'border-slate-line hover:border-slate focus:border-verdigris-deep',
    extra,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Label, hint, control, error — in that order, wired together.
 *
 * `hint` precedes the control because guidance that arrives after the mistake
 * is not guidance.
 */
export function Field({ label, hint, error, required = false, children, htmlFor, id }) {
  const generated = useId();
  const fieldId = htmlFor ?? id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-small font-medium text-ink">
        {label}
        {required ? (
          <span className="ms-1 text-flag" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ms-1.5 font-normal text-slate">(optional)</span>
        )}
      </label>

      {hint ? (
        <p id={hintId} className="text-caption text-slate">
          {hint}
        </p>
      ) : null}

      {children({
        id: fieldId,
        'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
        invalid: Boolean(error),
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-caption font-medium text-flag">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(function Input(
  { invalid = false, className = '', ...props },
  ref,
) {
  return <input ref={ref} className={controlClasses(invalid, className)} {...props} />;
});

export const Select = forwardRef(function Select(
  { invalid = false, className = '', children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      // `appearance-none` plus a drawn chevron, because the native control
      // renders at wildly different heights across Android browsers and the
      // 44px floor has to hold on all of them.
      //
      // `background-position` is one of the few CSS properties with no logical
      // equivalent — there is no `background-position-inline-start`. So the
      // chevron is placed physically and flipped with an explicit `rtl:`
      // variant, and the padding that keeps text clear of it is logical.
      className={controlClasses(
        invalid,
        [
          "appearance-none bg-[length:12px] bg-no-repeat pe-9",
          "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='%235A6E7F' d='M2 4l4 4 4-4z'/%3E%3C/svg%3E\")]",
          "bg-[right_0.85rem_center] rtl:bg-[left_0.85rem_center]", /* physical-ok: background-position has no logical form; both directions are given */
          className,
        ]
          .filter(Boolean)
          .join(' '),
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea(
  { invalid = false, rows = 4, className = '', ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={controlClasses(invalid, `py-2.5 leading-relaxed ${className}`)}
      {...props}
    />
  );
});

/**
 * A checkbox with its label as one tap target.
 *
 * The whole row is the target, not the 16px box — which is well under the
 * 44px floor and is the single most common accessibility failure in a form.
 */
export const Checkbox = forwardRef(function Checkbox(
  { label, hint, className = '', id, ...props },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className={`flex min-h-tap items-start gap-3 ${className}`}>
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        aria-describedby={hintId}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-line text-verdigris-deep focus:ring-verdigris-deep"
        {...props}
      />
      <label htmlFor={fieldId} className="cursor-pointer select-none text-small text-ink">
        {label}
        {hint ? (
          <span id={hintId} className="mt-0.5 block text-caption font-normal text-slate">
            {hint}
          </span>
        ) : null}
      </label>
    </div>
  );
});
