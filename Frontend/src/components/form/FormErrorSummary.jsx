/**
 * The form-level error summary.
 *
 * ── Why a summary and not just inline errors ───────────────────────────────
 * Inline errors tell you about the field you are looking at. On a form of a
 * dozen fields, after a failed submit, the fields you are *not* looking at are
 * the problem — and on a phone most of them are off screen. Somebody presses
 * "Create account", nothing appears to happen, and the reason is four fields
 * above the fold.
 *
 * So the summary appears at the top, counts the problems, links to each one,
 * and **takes focus**. That last part is what makes it work for a keyboard or
 * screen-reader user: the failure is announced rather than silently rendered
 * somewhere they are not.
 *
 * `tabIndex={-1}` makes it focusable programmatically without adding a stop to
 * the ordinary tab order.
 *
 * ── The voice ─────────────────────────────────────────────────────────────
 * It says what is wrong and what to do. It does not apologise, and it does not
 * say "Oops". A person filling in a registration form has not done anything
 * that warrants an apology from the interface, and being breezy about a blocked
 * task reads as not taking it seriously.
 */

import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Warning } from '../ui/Icon';

export const FormErrorSummary = forwardRef(function FormErrorSummary(
  { errors = [], formError = null, title },
  ref,
) {
  const { t } = useTranslation('common');
  const hasFieldErrors = errors.length > 0;

  if (!hasFieldErrors && !formError) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      // `alert` rather than `status`: this interrupts deliberately. The person
      // has just pressed a button and nothing happened; that is worth cutting
      // in for, which a confirmation would not be.
      role="alert"
      aria-labelledby="form-error-summary-title"
      className="rounded-card border border-flag/35 bg-flag-soft p-4 focus-visible:outline-flag"
    >
      <div className="flex items-start gap-3">
        <Warning className="mt-0.5 text-flag" />
        <div className="min-w-0 flex-1">
          <h2 id="form-error-summary-title" className="font-display text-subtitle text-flag">
            {title ??
              (hasFieldErrors
                ? t('form.summaryTitle', { count: errors.length })
                : t('state.errorTitle'))}
          </h2>

          {/*
            A server refusal that is not about one field — wrong password, an
            email already taken. Rendered as the server worded it: that copy is
            written for a person and is safe to display, and inventing our own
            would produce two explanations of one failure.
          */}
          {formError ? (
            <p className="mt-1 text-small text-ink">{formError.message}</p>
          ) : null}

          {hasFieldErrors ? (
            <ul className="mt-2 space-y-1">
              {errors.map((error) => (
                <li key={error.name}>
                  <a
                    href={`#${error.name}`}
                    onClick={(event) => {
                      // Focus the control itself rather than only scrolling to
                      // it, so the next keystroke goes where it is expected.
                      event.preventDefault();
                      const target = document.getElementById(error.name);
                      target?.focus();
                      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }}
                    className="text-small font-medium text-flag underline underline-offset-2 hover:no-underline"
                  >
                    {error.message}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
});
