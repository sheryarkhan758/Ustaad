/**
 * The home-tuition pathway — §6.29.1, and the platform's primary use case
 * (§2.1, decision 15).
 *
 * ── Why this is a pathway and not a filter ─────────────────────────────────
 * `/search` can already express female-only, home delivery and an area. Putting
 * the same three controls on a dedicated route would be duplication. It is not
 * the same thing, and FR-29.1 is explicit that it must not be built that way.
 *
 * A search page asks the family to assemble the arrangement themselves out of
 * seven filters, most of which are irrelevant to them, and to know in advance
 * that "female only" is an exclusion rather than a preference. This asks three
 * questions in the order a family would ask them — where, what, under what
 * conditions — and states plainly what is already fixed. The difference is
 * whether the product knows what the family is trying to do.
 *
 * ── The terminology this file is careful about ─────────────────────────────
 * The specification's note on terminology governs every string here: describe
 * the circumstance, never characterise the family. So the copy says "where
 * travelling to a tuition centre is not an option" and never anything about
 * why, which is not the platform's business and not knowable from a form.
 *
 * ── Verification is the result, not decoration ─────────────────────────────
 * This is a decision about who enters the house. Each result therefore leads
 * with what an administrator actually checked and on what date, and repeats —
 * at the same size, not in smaller grey — that no police or background check is
 * performed (SEC-6, FR-6.8). A tick would be the wrong answer to the only
 * question the family is really asking.
 *
 * ── The tutor is not a supply line ─────────────────────────────────────────
 * The reciprocal panel at the end is not a courtesy. §6.29.2 gives the visiting
 * tutor the same standing as the family, and a family that can see what she
 * will and will not be shown is a family that understands the arrangement it is
 * entering.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { CurriculumPicker } from '../../components/pickers/CurriculumPicker';
import { LocationPicker } from '../../components/pickers/LocationPicker';
import { Button } from '../../components/ui/Button';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Check, Warning } from '../../components/ui/Icon';
import { UserText } from '../../components/ui/UserText';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useAdjacentAreas, useAreas, useLocalName, useServiceTypes } from '../../lib/reference';

/**
 * The four categories FR-29.4 names, in the order it names them.
 *
 * Pinned rather than "every service type the reference table holds", because
 * that table also carries the §6.30 engagement shapes — exam preparation,
 * concept clarification — which answer a different question and would turn one
 * clear choice into a list of eight.
 */
const PATHWAY_CATEGORIES = [
  'academic-tuition',
  'grooming-mentoring',
  'quran-islamiat',
  'spoken-english',
];

const GUARDIAN_OPTIONS = ['throughout', 'residence', 'not_required'];

/** The artefacts an identity approval may name. Same keys as the result card. */
const ARTEFACT_KEY = {
  cnic: 'card.artefact.cnic',
  degree: 'card.artefact.degree',
  transcript: 'card.artefact.transcript',
};

/* =========================================================================
 * The verification record, stated
 * ====================================================================== */

/**
 * What was checked, by whom, and when — FR-6.5, FR-6.9.
 *
 * The disclaimer sits inside the same panel as the artefacts rather than in a
 * footnote. Somebody reading "CNIC and academic documents checked" is forming a
 * belief about how far that goes, and the sentence that bounds it has to be in
 * the same glance or it does not do its job.
 */
function VerificationRecord({ result }) {
  const { t } = useTranslation(['homeTuition', 'search']);
  const fmt = useFormat();
  const artefacts = result.verifiedArtefacts ?? [];

  return (
    <div className="rounded-control border border-verdigris/30 bg-verdigris-soft/40 px-3 py-2.5">
      <h4 className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
        {t('results.verificationHeading')}
      </h4>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Check size="sm" className="text-verdigris-deep" aria-hidden="true" />
        {artefacts.length > 0 ? (
          artefacts.map((artefact) => (
            <Badge key={artefact} tone="info">
              {t(`search:${ARTEFACT_KEY[artefact] ?? 'card.artefact.other'}`, {
                defaultValue: artefact,
              })}
            </Badge>
          ))
        ) : (
          <span className="text-caption text-slate">{t('search:card.identityChecked')}</span>
        )}
      </div>

      {result.verifiedAt ? (
        <p className="mt-1.5 text-caption text-ink">
          {t('results.verifiedOn', { date: fmt.date(result.verifiedAt) })}
        </p>
      ) : null}
      <p className="text-caption text-slate">{t('results.verifiedBy')}</p>

      {/* Same size as the line above it. Never smaller, never greyer (SEC-6). */}
      <p className="mt-1.5 text-caption text-ink">{t('results.noPoliceCheck')}</p>
    </div>
  );
}

/* =========================================================================
 * A result, presented for this decision
 * ====================================================================== */

function PathwayResult({ result, areasById, onAsk }) {
  const { t } = useTranslation(['homeTuition', 'search', 'common']);
  const localName = useLocalName();

  const travelsTo = (result.willingAreaIds ?? [])
    .map((id) => areasById.get(id))
    .filter(Boolean)
    .map((area) => localName(area).text);

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-subtitle text-ink">
            <Link to={`/t/${result.slug}`} className="hover:underline">
              {result.displayName}
            </Link>
          </h3>
          {result.experienceYears ? (
            <span className="text-caption text-slate">
              {t('search:card.experience', { count: result.experienceYears })}
            </span>
          ) : null}
        </div>

        {result.bio ? (
          <UserText className="line-clamp-3 text-small text-slate">{result.bio}</UserText>
        ) : null}

        <VerificationRecord result={result} />

        {travelsTo.length > 0 ? (
          <p className="text-caption text-slate">
            <span className="font-medium text-ink">{t('results.travelsTo')}:</span>{' '}
            {travelsTo.join('، ')}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button onClick={() => onAsk(result)}>{t('results.request')}</Button>
          <Link to={`/t/${result.slug}`} className="text-small text-verdigris-deep hover:underline">
            {t('results.seeRecord')}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

/* =========================================================================
 * The pathway
 * ====================================================================== */

export default function HomeTuition() {
  const { t } = useTranslation(['homeTuition', 'search', 'common']);
  const navigate = useNavigate();
  const localName = useLocalName();

  const [step, setStep] = useState(0);
  const [location, setLocation] = useState({ provinceId: null, cityId: null, areaId: null });
  const [category, setCategory] = useState('academic-tuition');
  const [curriculum, setCurriculum] = useState({});
  const [guardian, setGuardian] = useState('throughout');

  const serviceTypes = useServiceTypes();
  const areas = useAreas(location.cityId);
  const adjacent = useAdjacentAreas(location.areaId ? [location.areaId] : []);

  const areasById = useMemo(() => {
    const map = new Map();
    for (const area of areas.data ?? []) map.set(area.id, area);
    for (const area of adjacent.data ?? []) map.set(area.id, area);
    return map;
  }, [areas.data, adjacent.data]);

  const categories = useMemo(() => {
    const byId = new Map((serviceTypes.data ?? []).map((s) => [s.id, s]));
    return PATHWAY_CATEGORIES.map((id) => byId.get(id)).filter(Boolean);
  }, [serviceTypes.data]);

  /*
   * The query. `genderPreference` and `mode` are set here rather than offered:
   * they are what the pathway *is*. `includeAdjacentAreas` is on for the reason
   * §6.29.1 gives — a tutor one area over is a shorter journey than one across
   * the district, and a family that has to discover that by re-running a search
   * has been made to do the platform's work.
   */
  const params = useMemo(() => {
    const query = new URLSearchParams({
      genderPreference: 'female_only',
      mode: 'home',
      includeAdjacentAreas: 'true',
      limit: '20',
    });
    if (location.cityId) query.set('cityId', location.cityId);
    if (location.areaId) query.set('areaId', location.areaId);
    if (curriculum.subjectId) query.set('subjectId', curriculum.subjectId);
    if (curriculum.levelId) query.set('levelId', curriculum.levelId);
    if (curriculum.boardId) query.set('boardId', curriculum.boardId);
    return query.toString();
  }, [location.cityId, location.areaId, curriculum]);

  const results = useQuery({
    queryKey: ['home-tuition', params],
    queryFn: async () => (await api.get(`/search?${params}`)).results ?? [],
    // Only once the family has said where. A result set before that is a list
    // of tutors who cannot come.
    enabled: step === 3 && Boolean(location.areaId ?? location.cityId),
  });

  /**
   * Carry the pathway's answers into the booking form.
   *
   * The category and the guardian expectation are the two things this flow
   * established that the profile page cannot know, so they travel with the
   * navigation rather than being asked for a second time.
   */
  function ask(result) {
    navigate(`/book/${result.slug}`, {
      state: {
        fromPathway: 'home_tuition',
        serviceTypeId: category,
        guardianExpectation: guardian,
        mode: 'home',
        areaId: location.areaId ?? null,
      },
    });
  }

  const steps = ['area', 'need', 'conditions', 'results'];
  const canContinue = step === 0 ? Boolean(location.cityId) : true;

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <header className="space-y-2">
        <h1 className="font-display text-display text-ink">{t('page.title')}</h1>
        <p className="text-body text-slate">{t('page.intro')}</p>
      </header>

      {/* --- What is already decided, said once and kept on screen --------- */}
      <Card>
        <CardBody className="space-y-2">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
            {t('page.fixedHeading')}
          </h2>
          <ul className="space-y-1.5 text-small text-ink">
            <li className="flex gap-2">
              <Check size="sm" className="mt-1 shrink-0 text-verdigris-deep" aria-hidden="true" />
              <span>{t('page.fixedGender')}</span>
            </li>
            <li className="flex gap-2">
              <Check size="sm" className="mt-1 shrink-0 text-verdigris-deep" aria-hidden="true" />
              <span>{t('page.fixedMode')}</span>
            </li>
            <li className="flex gap-2">
              <Check size="sm" className="mt-1 shrink-0 text-verdigris-deep" aria-hidden="true" />
              <span>{t('page.fixedArea')}</span>
            </li>
          </ul>
        </CardBody>
      </Card>

      <p className="text-caption text-slate" aria-live="polite">
        {t('steps.of', { current: step + 1, total: steps.length })} — {t(`steps.${steps[step]}`)}
      </p>

      {/* --- 1. Where ------------------------------------------------------ */}
      {step === 0 ? (
        <Card>
          <CardBody className="space-y-4">
            <div>
              <h2 className="font-display text-subtitle text-ink">{t('area.heading')}</h2>
              <p className="mt-1 text-small text-slate">{t('area.body')}</p>
            </div>

            <LocationPicker value={location} onChange={setLocation} />

            <p className="text-caption text-slate">{t('area.nearbyNote')}</p>
            {adjacent.data?.length ? (
              <p className="text-caption text-ink">
                {t('area.adjacentCount', { count: adjacent.data.length })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* --- 2. What is needed --------------------------------------------- */}
      {step === 1 ? (
        <Card>
          <CardBody className="space-y-4">
            <div>
              <h2 className="font-display text-subtitle text-ink">{t('need.heading')}</h2>
              <p className="mt-1 text-small text-slate">{t('need.body')}</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="sr-only">{t('need.heading')}</legend>
              {categories.map((service) => (
                <label
                  key={service.id}
                  className={[
                    'flex min-h-tap cursor-pointer items-center gap-3 rounded-control border px-3 py-2',
                    category === service.id
                      ? 'border-verdigris bg-verdigris-soft/40'
                      : 'border-slate-line hover:bg-paper-sunk',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="service-category"
                    value={service.id}
                    checked={category === service.id}
                    onChange={() => setCategory(service.id)}
                    className="h-4 w-4 accent-verdigris-deep"
                  />
                  <span className="text-small text-ink">{localName(service).text}</span>
                </label>
              ))}
            </fieldset>

            {category === 'academic-tuition' ? (
              <div className="space-y-2 border-t border-slate-line pt-4">
                <h3 className="text-small font-medium text-ink">{t('need.academicHeading')}</h3>
                <p className="text-caption text-slate">{t('need.academicOptional')}</p>
                <CurriculumPicker value={curriculum} onChange={setCurriculum} />
              </div>
            ) : null}

            {/* Said plainly rather than implied. The category is recorded, not
                applied as a filter, and a family should not believe otherwise. */}
            <p className="text-caption text-slate">{t('need.carriedNote')}</p>
          </CardBody>
        </Card>
      ) : null}

      {/* --- 3. Conditions -------------------------------------------------- */}
      {step === 2 ? (
        <Card>
          <CardBody className="space-y-4">
            <div>
              <h2 className="font-display text-subtitle text-ink">{t('conditions.heading')}</h2>
              <p className="mt-1 text-small text-slate">{t('conditions.body')}</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-small font-medium text-ink">
                {t('conditions.guardianLabel')}
              </legend>
              {GUARDIAN_OPTIONS.map((option) => (
                <label
                  key={option}
                  className={[
                    'flex min-h-tap cursor-pointer items-center gap-3 rounded-control border px-3 py-2',
                    guardian === option
                      ? 'border-verdigris bg-verdigris-soft/40'
                      : 'border-slate-line hover:bg-paper-sunk',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="guardian-presence"
                    value={option}
                    checked={guardian === option}
                    onChange={() => setGuardian(option)}
                    className="h-4 w-4 accent-verdigris-deep"
                  />
                  <span className="text-small text-ink">{t(`conditions.guardian.${option}`)}</span>
                </label>
              ))}
            </fieldset>

            <p className="text-caption text-slate">{t('conditions.minorNote')}</p>

            <div className="flex gap-2 rounded-control border border-seal/35 bg-seal-soft px-3 py-2">
              <Warning size="sm" className="mt-0.5 shrink-0 text-seal-deep" aria-hidden="true" />
              <p className="text-caption text-ink">{t('conditions.tutorMayRequire')}</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* --- 4. The tutors -------------------------------------------------- */}
      {step === 3 ? (
        <section className="space-y-3">
          <h2 className="font-display text-subtitle text-ink">{t('results.heading')}</h2>

          {results.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}
          {results.isError ? <ErrorState error={results.error} onRetry={results.refetch} /> : null}

          {results.data?.length === 0 ? (
            <EmptyState title={t('results.empty')} description={t('results.emptyBody')} />
          ) : null}

          {results.data?.length ? (
            <>
              <p className="text-caption text-slate">
                {t('results.count', { count: results.data.length })}
              </p>
              {results.data.map((result) => (
                <PathwayResult
                  key={result.tutorId}
                  result={result}
                  areasById={areasById}
                  onAsk={ask}
                />
              ))}
            </>
          ) : null}

          {/* --- Her side of it, at the end of theirs --------------------- */}
          <Card>
            <CardBody className="space-y-1.5">
              <h2 className="font-display text-subtitle text-ink">{t('reciprocal.heading')}</h2>
              <p className="text-small text-slate">{t('reciprocal.body')}</p>
            </CardBody>
          </Card>
        </section>
      ) : null}

      {/* --- Moving between the steps -------------------------------------- */}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
            {t('steps.back')}
          </Button>
        ) : (
          <span />
        )}
        {step < steps.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            {t('steps.next')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
