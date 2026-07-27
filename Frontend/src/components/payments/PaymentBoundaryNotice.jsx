/**
 * The boundary, stated wherever payment appears — SEC-23, FR-31.10.
 *
 * ── Why this is a component and not a sentence someone remembers to write ──
 * "Ustaad.com does not process payments" is only true if it is true on *every*
 * screen where money appears. A rule enforced by remembering is a rule that
 * survives four screens and fails on the fifth — and the fifth is the one where
 * a family assumes the platform is holding their money and behaves accordingly.
 *
 * So the notice is one component, used everywhere payment appears, carrying
 * text that says the same three things every time:
 *
 *   1. what the platform **does** — records what was agreed and what both
 *      parties confirm was paid;
 *   2. what it **does not** do — process, hold or transfer money;
 *   3. who settles — the family and the tutor, directly, between themselves.
 *
 * The server says the identical thing: `PAYMENT_DISCLAIMER` is attached to
 * every payment response in `server/services/payment-records.ts`. Where a
 * response carries it, this component prefers the server's copy — one wording,
 * one place to change it.
 *
 * ── The absence this component protects ───────────────────────────────────
 * There is no pay button on any screen in this product, no card field, no
 * amount-to-charge, no gateway redirect and no wallet balance — because there
 * is no endpoint that would accept one (§2.6). `payments.test.jsx` asserts that
 * absence structurally rather than trusting a reviewer to notice: a "Pay now"
 * button added in good faith would be a defect, and the test is what catches
 * it.
 */

import { useTranslation } from 'react-i18next';

/**
 * @param {string} [disclaimer] The server's own wording, where a response
 *   carried it. Falls back to the dictionary — which is also what makes the
 *   notice readable in Urdu, since the server's copy is English (FR-27.1).
 */
export function PaymentBoundaryNotice({ disclaimer = null, className = '' }) {
  const { t, i18n } = useTranslation('payments');

  // The server's sentence is authored in English. In Urdu the dictionary wins,
  // because an English paragraph in an otherwise-Urdu page is not a disclosure
  // — it is a thing the reader skips.
  const text = disclaimer && i18n.resolvedLanguage !== 'ur' ? disclaimer : t('boundary.body');

  return (
    <aside
      // Not `role="alert"`: this is a standing property of the product, not a
      // thing that just happened. An alert would interrupt a screen reader
      // every time a page mentioned money.
      aria-label={t('boundary.heading')}
      className={[
        'rounded-control border border-slate-line bg-paper px-4 py-3 text-small text-ink',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="text-caption font-semibold uppercase tracking-wide text-slate">
        {t('boundary.heading')}
      </p>
      <p className="mt-1">{text}</p>
    </aside>
  );
}
