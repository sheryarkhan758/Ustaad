/**
 * Why this family is in this group — FR-23.7, decision 10.
 *
 * ── This component is the reason the matcher is not a model ────────────────
 * Decision 10 chose constraint satisfaction over AI for one stated purpose:
 * "a family can be told why it was grouped". A solver that produced groups
 * nobody could explain would satisfy the requirement's letter and none of its
 * point, and the explanation existing in the API but not on screen would be the
 * same failure one layer up.
 *
 * So the conditions are listed as conditions — each one had to hold, and any
 * one failing would have left the group unformed. It is deliberately not
 * phrased as "we found a great match for you": that framing invites the reader
 * to trust a judgement, and there is no judgement here to trust. There is a
 * rule, and it is shown.
 *
 * ── Rendered from codes, not from the server's sentences ───────────────────
 * The solver also emits English prose (`explanation`), which is what the API
 * returns and what a log or a test reads. This renders `reasonCodes` through
 * the dictionary instead, so the Urdu view gets Urdu rather than English inside
 * an Urdu page. The prose is the fallback for a proposal made before codes
 * existed — those rows are real and their explanation still has to appear.
 */

import { useTranslation } from 'react-i18next';

import { Check } from '../ui/Icon';

/** `2|16:00|18:00` → "Tuesday 16:00–18:00", in the reader's language. */
function useWindowFormatter() {
  const { t } = useTranslation('common');

  return (packed) =>
    String(packed ?? '')
      .split(',')
      .filter(Boolean)
      .map((entry) => {
        const [weekday, from, to] = entry.split('|');
        return `${t(`weekday.${weekday}`, { defaultValue: weekday })} ${from}–${to}`;
      })
      .join('، ');
}

/**
 * @param {object[]} reasonCodes `{ code, params }` from the solver.
 * @param {string[]} fallback The server's English prose, for older proposals.
 */
export function GroupingReasons({ reasonCodes = [], fallback = [] }) {
  const { t } = useTranslation(['groups', 'common']);
  const formatWindows = useWindowFormatter();

  const lines =
    reasonCodes.length > 0
      ? reasonCodes.map(({ code, params }) => {
          // `others` and `count` drive i18next's plural selection; the window
          // string is expanded here because only the client knows the day names.
          const values = {
            ...params,
            ...(params?.windows ? { windows: formatWindows(params.windows) } : {}),
            ...(params?.gender ? { gender: t(`why.gender.${params.gender}`) } : {}),
          };
          const count = params?.others ?? params?.count;
          return t(`why.${code}`, { ...values, count });
        })
      : fallback;

  if (lines.length === 0) return null;

  return (
    <section aria-labelledby="grouping-reasons-heading" className="space-y-2">
      <h3 id="grouping-reasons-heading" className="font-display text-subtitle text-ink">
        {t('why.heading')}
      </h3>
      <p className="text-small text-slate">{t('why.body')}</p>
      <ul className="space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-small text-ink">
            <Check size="sm" className="mt-1 shrink-0 text-verdigris-deep" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
