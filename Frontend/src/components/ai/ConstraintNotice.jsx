/**
 * Who applied the hard constraints — §7.2, FR-10.12, FR-16.4.
 *
 * ── Why this is stated rather than trusted ─────────────────────────────────
 * A parent who told a conversational agent "only a female tutor" has just made
 * a safety requirement to something that looks like a chatbot. Everything they
 * know about chatbots says it might forget, might be talked out of it, might
 * approximate. In this system it cannot — and the difference between "cannot"
 * and "probably will not" is the whole of §2.4.
 *
 * So the interface says which one it is. `searchToolCallSchema` in
 * `shared/ai-contract.ts` carries `topicIds`, `levelId` and `boardId` and
 * **nothing else**: no gender field, no budget field, no area field. The model
 * has no way to express a relaxation of a constraint, and the filter runs in
 * SQL over the tool's result after the model has finished speaking. A tutor
 * who does not match is *absent*, not ranked lower.
 *
 * Saying so costs three lines and converts a promise into an explanation the
 * reader can check. Leaving it unsaid asks a mother to take it on faith from
 * the least trustworthy-looking part of the product.
 */

import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/Card';
import { Check } from '../ui/Icon';
import { useFormat } from '../../lib/format';

/**
 * @param {object} constraints `{ genderPreference, areaId, maxHourlyRate }` —
 *   exactly what was sent to the server, so the notice describes what was
 *   applied rather than what the form currently shows.
 * @param {string} [areaName] Resolved from reference data by the caller.
 */
export function ConstraintNotice({ constraints, areaName = null }) {
  const { t } = useTranslation('ai');
  const fmt = useFormat();

  const applied = [];

  // Gender first, always. It is the one with a safety meaning, and the one a
  // family most needs to know was enforced rather than suggested.
  if (constraints?.genderPreference && constraints.genderPreference !== 'no_preference') {
    applied.push({
      key: 'gender',
      label: t(`constraints.gender.${constraints.genderPreference}`),
    });
  }
  if (areaName) applied.push({ key: 'area', label: t('constraints.area', { area: areaName }) });
  if (constraints?.maxHourlyRate) {
    applied.push({
      key: 'budget',
      label: t('constraints.budget', { amount: fmt.paisa(constraints.maxHourlyRate) }),
    });
  }

  if (applied.length === 0) return null;

  return (
    <section
      aria-labelledby="constraint-notice-heading"
      className="rounded-control border border-verdigris/25 bg-verdigris-soft px-4 py-3"
    >
      <h3
        id="constraint-notice-heading"
        className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep"
      >
        {t('constraints.heading')}
      </h3>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {applied.map((item) => (
          <li key={item.key}>
            <Badge tone="verdigris">
              <Check size="sm" aria-hidden="true" />
              {item.label}
            </Badge>
          </li>
        ))}
      </ul>

      {/*
        The sentence that does the work. Names the mechanism — a filter in the
        database query, after the model has answered — because "the system
        applied it" is still a promise, and "the model has no field for it" is
        a fact somebody can verify.
      */}
      <p className="mt-2 text-small text-ink">{t('constraints.enforcedByCode')}</p>
      <p className="mt-1 text-caption text-slate">{t('constraints.notRanking')}</p>
    </section>
  );
}
