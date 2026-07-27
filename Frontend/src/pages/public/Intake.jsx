/**
 * The diagnostic intake page — §6.10.
 *
 * Anonymous browsing is the rule everywhere else in this product (FR-1.6), but
 * an intake session is written against a user and the endpoints require an
 * account. Rather than let somebody type four paragraphs and then meet a login
 * wall, the page says so before the composer — and offers manual search, which
 * genuinely needs no account, in the same breath.
 *
 * The constraints panel sits **above** the conversation deliberately. A family
 * that sets "female tutors only" before describing the problem has the
 * assurance in place while they type; asking afterwards makes it feel like a
 * filter applied to a result rather than a condition of the search.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { IntakeConversation } from '../../components/ai/IntakeConversation';
import { ManualSearchLink } from '../../components/ai/AiFallback';
import { LocationPicker } from '../../components/pickers/LocationPicker';
import { Card, CardBody } from '../../components/ui/Card';
import { Field, Select } from '../../components/ui/Field';
import { useAuth } from '../../context/AuthContext';
import { useAreas, useLocalName } from '../../lib/reference';

const GENDER_PREFERENCES = ['no_preference', 'female_only', 'male_only'];

export default function Intake() {
  const { t } = useTranslation(['ai', 'search', 'common']);
  const { isAuthenticated } = useAuth();
  const localName = useLocalName();

  const [genderPreference, setGenderPreference] = useState('no_preference');
  const [location, setLocation] = useState({ provinceId: null, cityId: null, areaId: null });

  const areas = useAreas(location.cityId);
  const areaRow = (areas.data ?? []).find((area) => area.id === location.areaId);
  const areaName = areaRow ? localName(areaRow).text : null;

  const constraints = {
    genderPreference,
    ...(location.cityId ? { cityId: location.cityId } : {}),
    ...(location.areaId ? { areaId: location.areaId } : {}),
  };

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('intake.pageTitle')}</h1>
        <p className="mt-1 text-body text-slate">{t('intake.pageBody')}</p>
      </header>

      {/* --- The constraints, set before the conversation ------------------ */}
      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="font-display text-subtitle text-ink">{t('intake.constraintsTitle')}</h2>
            <p className="mt-0.5 text-caption text-slate">{t('intake.constraintsBody')}</p>
          </div>

          <Field label={t('search:filters.gender')} htmlFor="intake-gender">
            {(props) => (
              <Select
                {...props}
                id="intake-gender"
                value={genderPreference}
                onChange={(event) => setGenderPreference(event.target.value)}
              >
                {GENDER_PREFERENCES.map((option) => (
                  <option key={option} value={option}>
                    {t(`search:gender.${option}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <LocationPicker value={location} onChange={setLocation} />
        </CardBody>
      </Card>

      {isAuthenticated ? (
        <IntakeConversation constraints={constraints} areaName={areaName} />
      ) : (
        <Card>
          <CardBody className="space-y-3">
            <h2 className="font-display text-subtitle text-ink">{t('intake.signInTitle')}</h2>
            {/* Said before they type, not after. */}
            <p className="text-small text-ink">{t('intake.signInBody')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/login"
                className="inline-flex min-h-tap items-center rounded-control bg-ink px-4 text-small font-medium text-white hover:bg-ink-deep"
              >
                {t('common:action.signIn')}
              </Link>
              <ManualSearchLink />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
