/**
 * What each side will see, and what each side must agree to — SEC-19, SEC-20.
 *
 * ── Two components, one purpose: nobody is surprised ───────────────────────
 *
 * `AddressDisclosure` states the address rule. It renders identically for the
 * family and for the tutor, from the same strings, because the value of the
 * rule is that both people know the same thing about it:
 *
 *   · before she confirms, the tutor sees the **area** — she is deciding
 *     whether to travel alone to a house she has not seen, and withholding the
 *     locality would make that decision impossible;
 *   · after she confirms, she sees the **street address** — and not a moment
 *     earlier, so a family's address is never handed to somebody who then
 *     declines.
 *
 * A family that does not know this rule reads "enter your address" as "publish
 * my address", and either abandons the booking or enters something false. A
 * tutor who does not know it reads "area only" as the platform withholding
 * something from her. Saying it to both, in the same words, costs one
 * paragraph.
 *
 * `GuardianPresenceNotice` is the tutor's declared condition, acknowledged
 * before submission rather than refused after it. The server enforces this —
 * `createBookingRequest` returns 409 `safety_constraint` without the
 * acknowledgement — and the checkbox exists so a family is told the condition
 * up front instead of discovering it in an error.
 *
 * The wording matters and is deliberate: these are **her conditions**, stated
 * as fact, not as a preference she might be talked out of. And the note that
 * declines made under them do not affect her statistics is here as well as on
 * her own screen (SEC-21) — a family that understands why she declined is less
 * likely to take it personally.
 */

import { useTranslation } from 'react-i18next';

import { Checkbox } from '../ui/Field';
import { Warning } from '../ui/Icon';

/**
 * The address rule, stated once, to whoever is reading.
 *
 * @param {'family'|'tutor'} audience Which side is reading. Changes the
 *   pronouns and nothing else — the rule described is identical.
 */
export function AddressDisclosure({ audience = 'family', confirmed = false }) {
  const { t } = useTranslation('booking');

  return (
    <section
      aria-labelledby="address-disclosure-heading"
      className="rounded-control border border-slate-line bg-paper px-4 py-3"
    >
      <h3
        id="address-disclosure-heading"
        className="text-caption font-semibold uppercase tracking-wide text-slate"
      >
        {t('disclosure.heading')}
      </h3>

      <ul className="mt-2 space-y-1.5 text-small text-ink">
        <li>{t(`disclosure.${audience}.beforeConfirm`)}</li>
        <li>{t(`disclosure.${audience}.afterConfirm`)}</li>
        <li>{t('disclosure.nobodyElse')}</li>
      </ul>

      {/*
        After confirmation the rule has already run its course, so saying "she
        will see it once she confirms" would be describing the past as the
        future.
      */}
      {confirmed ? (
        <p className="mt-2 text-caption text-slate">{t(`disclosure.${audience}.nowVisible`)}</p>
      ) : null}
    </section>
  );
}

/**
 * The tutor's declared conditions, and the acknowledgement one of them needs.
 *
 * @param {object} safety `{ guardianPresenceRequired, femaleStudentsOnly }`
 *   from the public profile.
 * @param {boolean} acknowledged
 * @param {(next: boolean) => void} onAcknowledge
 * @param {string} [error] A server-side refusal to surface against the field.
 */
export function GuardianPresenceNotice({
  safety,
  acknowledged = false,
  onAcknowledge,
  error = null,
}) {
  const { t } = useTranslation('booking');

  const hasAny = safety?.guardianPresenceRequired || safety?.femaleStudentsOnly;
  if (!hasAny) return null;

  return (
    <section
      aria-labelledby="safety-conditions-heading"
      className="rounded-control border border-seal/35 bg-seal-soft px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <Warning size="sm" className="mt-0.5 shrink-0 text-seal-deep" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3
            id="safety-conditions-heading"
            className="text-caption font-semibold uppercase tracking-wide text-seal-deep"
          >
            {t('safety.heading')}
          </h3>

          {/* Stated as her conditions, in the present tense. Not "prefers". */}
          <ul className="mt-2 space-y-1 text-small text-ink">
            {safety.guardianPresenceRequired ? <li>{t('safety.guardianRequired')}</li> : null}
            {safety.femaleStudentsOnly ? <li>{t('safety.femaleStudentsOnly')}</li> : null}
          </ul>

          <p className="mt-2 text-caption text-slate">{t('safety.enforcedNote')}</p>

          {safety.guardianPresenceRequired ? (
            <div className="mt-3">
              {/*
                `Field` only for the error slot — the checkbox carries its own
                label and hint, and a second visible label above a checkbox
                reads as two separate questions.
              */}
              {error ? (
                <p role="alert" className="mb-1 text-caption font-medium text-flag">
                  {error}
                </p>
              ) : null}
              <Checkbox
                id="guardian-ack"
                checked={acknowledged}
                onChange={(event) => onAcknowledge?.(event.target.checked)}
                label={t('safety.acknowledgeLabel')}
                hint={t('safety.acknowledgeHint')}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
