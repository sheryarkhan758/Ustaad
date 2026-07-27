/**
 * What a tutor decides on, before she decides — §6.29.2, FR-29.13.
 *
 * ── The four facts, and why they are these four ────────────────────────────
 * A woman is being asked to travel alone to a house she has not seen, belonging
 * to people she has not met. Deciding whether to do that needs: where — to the
 * area, which tells her the journey and the neighbourhood — who she would be
 * teaching, whether an adult will be in the residence, and when. Everything
 * else on the booking page is about the arrangement; this panel is about her.
 *
 * ── The address is absent, not hidden ──────────────────────────────────────
 * `GET /api/bookings/:id/engagement` selects no address column, so there is
 * nothing here to withhold. Before she confirms, the street does not travel to
 * her browser at all; after she confirms, `AddressDisclosure` and the booking
 * record carry it (SEC-20, FR-29.9). The distinction matters: a field hidden by
 * CSS is a field that was sent.
 *
 * ── Why the statistics sentence is in this panel ───────────────────────────
 * FR-29.14 excludes declines made under a declared condition from her
 * confirmation-rate statistic, and the specification's own design note explains
 * why: a platform that penalised those declines would be quietly pressuring her
 * to accept engagements she had already said she would not. A protection she
 * does not know about does not remove the pressure — she is still deciding as
 * though declining will cost her. So it is stated here, on the screen where she
 * decides, and not in a policy page.
 *
 * ── Presented as a record, not an alert ────────────────────────────────────
 * Deliberately the same table treatment the rest of the booking uses. Rendering
 * a woman's safety information in warning colours would frame every engagement
 * as a threat, which is both untrue and its own kind of pressure. These are
 * facts she is entitled to; they are laid out like facts.
 */

import { useTranslation } from 'react-i18next';

import { Card, CardBody, Table, Td, Th } from '../ui/Card';
import { useFormat } from '../../lib/format';
import { useLocalName } from '../../lib/reference';

/**
 * @param {object} engagement From `GET /api/bookings/:id/engagement`.
 * @param {object|null} safety Her own declared conditions, if loaded.
 */
export function EngagementReview({ engagement, safety = null }) {
  const { t } = useTranslation(['booking', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();

  if (!engagement) return null;

  // The area is named from the payload's own fields — `useLocalName` picks the
  // Urdu form where one exists and falls back to the Latin spelling where it
  // does not, which for Pakistani place names is frequently the right answer.
  const area = engagement.areaName
    ? localName({ name: engagement.areaName, nameUr: engagement.areaNameUr }).text
    : null;

  const declared = [
    safety?.femaleStudentsOnly ? t('engagement.declaredFemaleOnly') : null,
    safety?.guardianPresenceRequired ? t('engagement.declaredGuardian') : null,
    safety?.restrictedAreaIds?.length ? t('engagement.declaredAreas') : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="font-display text-subtitle text-ink">{t('engagement.heading')}</h2>
          <p className="mt-1 text-small text-slate">{t('engagement.body')}</p>
        </div>

        <Table caption={t('engagement.caption')}>
          <tbody>
            <tr>
              <Th>{t('engagement.where')}</Th>
              <Td>
                {engagement.mode === 'home'
                  ? (area ?? t('engagement.areaUnknown'))
                  : t(`common:mode.${engagement.mode}`)}
              </Td>
            </tr>
            <tr>
              <Th>{t('engagement.student')}</Th>
              <Td>
                {engagement.studentGender
                  ? t(`engagement.gender.${engagement.studentGender}`)
                  : t('engagement.genderNotRecorded')}
                {engagement.studentIsMinor ? ` · ${t('engagement.minor')}` : ''}
              </Td>
            </tr>
            <tr>
              <Th>{t('engagement.guardian')}</Th>
              <Td>
                {engagement.guardianPresenceRequired
                  ? t('engagement.guardianYes')
                  : t('engagement.guardianNo')}
              </Td>
            </tr>
            {engagement.slotStart ? (
              <tr>
                <Th>{t('engagement.when')}</Th>
                <Td>{fmt.dateTime(engagement.slotStart)}</Td>
              </tr>
            ) : null}
            {engagement.travelChargeAgreed > 0 ? (
              <tr>
                <Th>{t('engagement.travelCharge')}</Th>
                <Td numeric>{fmt.paisa(engagement.travelChargeAgreed)}</Td>
              </tr>
            ) : null}
          </tbody>
        </Table>

        {/* Where the street is, and when she gets it. Said before she asks. */}
        <p className="text-caption text-slate">{t('engagement.addressAfter')}</p>

        {declared.length > 0 ? (
          <div className="border-t border-slate-line pt-3">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
              {t('engagement.declaredHeading')}
            </h3>
            <ul className="mt-1.5 space-y-1 text-small text-ink">
              {declared.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption text-slate">{t('engagement.declaredEnforced')}</p>
          </div>
        ) : null}

        {/* FR-29.14, stated where she is deciding. */}
        <p className="rounded-control bg-paper-sunk px-3 py-2 text-small text-ink">
          {t('engagement.declineFree')}
        </p>
      </CardBody>
    </Card>
  );
}
