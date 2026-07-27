/**
 * Number, date and currency formatting. **One helper, used everywhere.**
 *
 * ── Numerals stay Western-Arabic in both languages ─────────────────────────
 * FR-27.6. Every formatter below pins `numberingSystem: 'latn'`, so `18,000`
 * reads `18,000` in the Urdu view too rather than `١٨٬٠٠٠`.
 *
 * That is a deliberate choice against the locale default, and the reason is
 * unambiguity about money. Eastern-Arabic digits are perfectly readable to many
 * Urdu speakers and unreadable to plenty of others — including the same parent
 * on a different day, comparing a rate against a bank statement printed in
 * Latin digits. An amount somebody misreads is worse than a label they have to
 * work slightly harder at.
 *
 * ── Money arrives as integer paisa ─────────────────────────────────────────
 * The backend stores every amount as integer paisa (1 PKR = 100 paisa) and
 * never as a float or a decimal string. So the *only* correct way to render one
 * is through `formatPaisa`, which does the division in one place. A component
 * that divides by 100 itself is a component that will one day divide by 100
 * twice.
 *
 * ── Grouping ───────────────────────────────────────────────────────────────
 * `en-PK` and `ur-PK` both group in thousands — 1,80,000 (the Indian lakh
 * grouping) is *not* what Pakistani users expect for currency, despite the
 * shared regional history. `Intl` gets this right for `PK`; it is stated here
 * because it looks like an oversight otherwise.
 */

const NUMERIC_LOCALE = { en: 'en-PK', ur: 'ur-PK' };

/** Cached, because constructing an Intl formatter is not free and lists re-render. */
const cache = new Map();

function formatter(kind, lng, options) {
  const key = `${kind}|${lng}|${JSON.stringify(options)}`;
  let existing = cache.get(key);
  if (existing) return existing;

  const locale = NUMERIC_LOCALE[lng] ?? NUMERIC_LOCALE.en;
  const Ctor = kind === 'date' ? Intl.DateTimeFormat : Intl.NumberFormat;

  try {
    existing = new Ctor(locale, { numberingSystem: 'latn', ...options });
  } catch {
    // An environment without full ICU falls back to English rather than
    // throwing mid-render. A rate in the wrong locale still reads; a crash
    // does not.
    existing = new Ctor('en-PK', { numberingSystem: 'latn', ...options });
  }

  cache.set(key, existing);
  return existing;
}

/** `18000` → `18,000` */
export function formatNumber(value, lng = 'en', options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return formatter('number', lng, options).format(Number(value));
}

/**
 * Integer paisa → a displayable amount.
 *
 * `1_800_000` → `PKR 18,000`
 *
 * Fractional rupees are never shown: the platform records whole-rupee
 * agreements, and `PKR 18,000.00` implies a precision the arrangement does not
 * have.
 */
export function formatPaisa(paisa, lng = 'en', { withSymbol = true } = {}) {
  if (paisa === null || paisa === undefined || Number.isNaN(Number(paisa))) return '—';

  const rupees = Number(paisa) / 100;

  return formatter('number', lng, {
    style: withSymbol ? 'currency' : 'decimal',
    currency: 'PKR',
    currencyDisplay: 'code', // `PKR 18,000`, not `Rs 18,000` — unambiguous in both scripts
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

/** `2026-07-27` → `27 Jul 2026` */
export function formatDate(value, lng = 'en', options = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return formatter('date', lng, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(date);
}

export function formatDateTime(value, lng = 'en') {
  return formatDate(value, lng, { hour: '2-digit', minute: '2-digit', hour12: true });
}

/** `0.87` → `87%` */
export function formatPercent(fraction, lng = 'en') {
  if (fraction === null || fraction === undefined) return '—';
  return formatter('number', lng, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Number(fraction));
}

/**
 * Bind every formatter to the active language.
 *
 *   const fmt = useFormat();
 *   fmt.paisa(1_800_000);  // "PKR 18,000"
 *
 * A hook rather than passing `lng` at each call site, because the call site
 * that forgets it silently formats in English for an Urdu reader.
 */
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

export function useFormat() {
  const { i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  return useMemo(
    () => ({
      lng,
      number: (value, options) => formatNumber(value, lng, options),
      paisa: (value, options) => formatPaisa(value, lng, options),
      date: (value, options) => formatDate(value, lng, options),
      dateTime: (value) => formatDateTime(value, lng),
      percent: (value) => formatPercent(value, lng),
    }),
    [lng],
  );
}
