/**
 * The hard-constraint indicator — §6.16, FR-16.3, FR-16.4, decision 8.
 *
 * ── Why this is a banner and not a chip ────────────────────────────────────
 * Gender preference is not a filter like the others. Every other control on the
 * search page narrows a list; this one **removes people from existence** as far
 * as the result set is concerned. A male tutor under `female_only` is not
 * ranked last, not greyed out, not behind a "show more" — he is absent, because
 * the server excluded him in the SQL predicate before ranking began.
 *
 * A parent needs to *know* that, and the reason is trust rather than tidiness.
 * §2.1: in households where daughters are not permitted to travel, a female
 * tutor who teaches at home is not a preference accommodated at the margins —
 * it is the only arrangement under which any tuition happens at all. A parent
 * who suspects the platform is merely *sorting* by gender has to check every
 * result themselves, and at that point the filter has bought them nothing.
 *
 * So: full width, above the results, stating in plain words that the exclusion
 * happened on the server and that no non-matching tutor is anywhere in the list.
 * A chip among ten other chips would say the opposite — that this is one
 * preference among many.
 *
 * ── It is never presented as a sort ────────────────────────────────────────
 * No copy anywhere in this component uses "prefer", "prioritise", "first" or
 * "ranked". The verbs are "excluded", "not shown", "restricted".
 *
 * ── It reflects the server's answer, not the request ───────────────────────
 * `appliedGenderPreference` comes back on the response so a caller can see the
 * exclusion was applied server-side. This renders *that*, not the local filter
 * state — if the two ever disagreed, showing the local one would be a lie in
 * the exact place a parent is trusting us.
 */

import { useTranslation } from 'react-i18next';

import { Check } from '../ui/Icon';

export function GenderRestrictionBanner({ appliedGenderPreference, resultCount, onClear }) {
  const { t } = useTranslation('search');

  // `no_preference` is the default and the system never sets anything else on
  // a user's behalf (FR-16.6), so there is nothing to announce.
  if (!appliedGenderPreference || appliedGenderPreference === 'no_preference') return null;

  const isFemaleOnly = appliedGenderPreference === 'female_only';

  return (
    <section
      // `region` with a name, so a screen-reader user can find it deliberately
      // rather than only meeting it in the reading order.
      role="region"
      aria-label={t('restriction.regionLabel')}
      className="rounded-card border-2 border-verdigris bg-verdigris-soft p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-verdigris text-white"
        >
          <Check size="sm" />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-subtitle text-verdigris-deep">
            {isFemaleOnly ? t('restriction.femaleTitle') : t('restriction.maleTitle')}
          </h2>

          {/*
            The sentence that does the work. "Excluded", not "prioritised".
          */}
          <p className="mt-1 text-small text-ink">
            {isFemaleOnly ? t('restriction.femaleBody') : t('restriction.maleBody')}
          </p>

          <p className="mt-2 text-caption text-verdigris-deep">
            {t('restriction.enforcedNote')}
          </p>

          {typeof resultCount === 'number' ? (
            <p className="mt-2 font-mono text-caption tnum text-slate">
              {t('restriction.countNote', { count: resultCount })}
            </p>
          ) : null}
        </div>

        {onClear ? (
          <button
            type="button"
            onClick={onClear}
            className="min-h-tap shrink-0 rounded-control border border-verdigris/40 bg-white px-3 text-small font-medium text-verdigris-deep hover:bg-verdigris-soft"
          >
            {t('restriction.remove')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
