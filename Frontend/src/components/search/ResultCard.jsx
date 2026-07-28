/**
 * A search result — §6.7, FR-7.2.
 *
 * ── The client computes nothing ────────────────────────────────────────────
 * Every figure here arrives already computed: `normalisedHourly` and
 * `benchmarkMedian` from materialised columns, reliability from
 * `tutor_reliability`, per-topic verdicts from the competency track, the score
 * and its `breakdown` from `shared/ranking.ts` running on the server.
 *
 * This component's only arithmetic is choosing which of three words to print
 * for the rate band, and that is a presentation decision over a server figure —
 * not a recomputation of it. **No component here derives a median from the
 * results on screen**, which would reconstruct exactly what SEC-17 withheld.
 *
 * ── Verification is itemised, never a tick ─────────────────────────────────
 * The card says which artefacts were checked and names the competency verdicts
 * per topic. A single "Verified" pill is what §2.5 and SEC-6 exist to prevent,
 * and a result card is the highest-traffic place that mistake could be made.
 *
 * An **expired** competency badge is shown as expired rather than omitted: a
 * tutor who passed and lapsed is in a different position from one who never
 * sat, and hiding the difference would flatter the second at the first's
 * expense.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge, Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Check, Clock, Warning } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { RateBadge } from './RateBenchmark';
import { useComparisonTray } from '../../context/ComparisonTrayContext';
import { useFormat } from '../../lib/format';
import { useLocalName } from '../../lib/reference';

/** The artefacts an identity approval may name. */
const ARTEFACT_KEY = {
  cnic: 'card.artefact.cnic',
  degree: 'card.artefact.degree',
  transcript: 'card.artefact.transcript',
};

function VerificationLine({ result }) {
  const { t } = useTranslation('search');
  const artefacts = result.verifiedArtefacts ?? [];

  if (artefacts.length === 0) {
    // Every tutor in a result set has passed identity verification — the
    // searchable-status gate guarantees it — so an empty list means the
    // artefact detail did not come back, not that nothing was checked.
    return (
      <p className="text-caption text-slate">{t('card.identityChecked')}</p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Check size="sm" className="text-verdigris-deep" />
      <span className="text-caption text-slate">{t('card.checkedLabel')}</span>
      {artefacts.map((artefact) => (
        <Badge key={artefact} tone="info">
          {t(ARTEFACT_KEY[artefact] ?? 'card.artefact.other', { defaultValue: artefact })}
        </Badge>
      ))}
    </div>
  );
}

function CompetencyLine({ result, topics }) {
  const { t } = useTranslation('search');
  const localName = useLocalName();
  const verdicts = result.competency ?? [];

  if (verdicts.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {verdicts.map((verdict) => {
        const topic = topics?.find((row) => row.id === verdict.topicId);
        const shown = topic ? localName(topic) : { text: verdict.topicId, lang: undefined };
        const expired = verdict.status === 'expired';

        return (
          <li key={verdict.topicId}>
            <Badge tone={expired ? 'warning' : verdict.status === 'verified' ? 'info' : 'neutral'}>
              {expired ? <Warning size="sm" /> : <Check size="sm" />}
              <span lang={shown.lang}>{shown.text}</span>
              {expired ? <span className="ms-1">{t('card.lapsed')}</span> : null}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export function ResultCard({ result, topics, areas = [] }) {
  const { t } = useTranslation(['search', 'booking', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();
  const tray = useComparisonTray();

  /*
   * The search response is **flat** — `tutorId`, `slug`, `displayName` and the
   * rest sit at the top level of a result rather than under a nested `tutor`.
   * Naming the pieces here once, rather than reaching through an object shape
   * the endpoint does not send, is what keeps this card and
   * `GET /api/search` in step.
   */
  const { normalisedHourly, benchmarkMedian, travelMinutes } = result;
  const tutorId = result.tutorId;
  const inTray = tray.has(tutorId);

  // Area is the finest granularity this product has, and a card shows the
  // first area she travels to — never a street, never a distance (SEC-3).
  const areaId = result.willingAreaIds?.[0] ?? null;
  const areaRow = areaId ? (areas ?? []).find((row) => row.id === areaId) : null;
  const areaName = areaRow ? localName(areaRow) : null;

  return (
    // A result rises as it arrives, so a new page of results reads as having
    // replaced the old one rather than having been swapped underneath.
    <Card interactive as="article" className="animate-rise">
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-subtitle text-ink">
              <Link
                to={`/tutors/${result.slug}`}
                className="hover:text-verdigris-deep hover:underline underline-offset-2"
              >
                {result.displayName}
              </Link>
            </h3>

            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-slate">
              {areaName ? <span lang={areaName.lang}>{areaName.text}</span> : null}
              {/* Area, never an address. The finest granularity there is (§4.2). */}
              {travelMinutes !== null && travelMinutes !== undefined ? (
                <span className="tnum">
                  {t('card.travelMinutes', { minutes: travelMinutes })}
                </span>
              ) : null}
              {result.experienceYears ? (
                <span className="tnum">
                  {t('card.experience', { count: result.experienceYears })}
                </span>
              ) : null}
            </p>
          </div>

          {/* FR-33.10 — the flag never substitutes for verification. */}
          {result.volunteer ? <Badge tone="settled">{t('card.volunteer')}</Badge> : null}
        </div>

        <VerificationLine result={result} />
        <CompetencyLine result={result} topics={topics} />

        {result.bio ? (
          // Verbatim, never translated (§2.10). `line-clamp` truncates the
          // display without touching the stored text.
          <UserText className="line-clamp-2 text-small text-slate">{result.bio}</UserText>
        ) : null}

        {/* --- Rate, against the local benchmark ------------------------ */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-slate-line pt-3">
          {normalisedHourly ? (
            <>
              <p className="font-mono text-subtitle tnum text-ink">
                {fmt.paisa(normalisedHourly)}
                <span className="ms-1 font-body text-caption font-normal text-slate">
                  {t('card.perHour')}
                </span>
              </p>
              {/* Renders nothing at all below the SEC-17 cohort of four. */}
              <RateBadge normalisedHourly={normalisedHourly} benchmarkMedian={benchmarkMedian} />
            </>
          ) : (
            <p className="text-small text-slate">{t('card.noRate')}</p>
          )}
        </div>

        {/* --- Reliability, from tutor_reliability ----------------------- */}
        {result.reliability ? (
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-caption">
            {result.reliability.confirmationRate !== null &&
            result.reliability.confirmationRate !== undefined ? (
              <div>
                <dt className="inline text-slate">{t('card.confirmationRate')} </dt>
                <dd className="inline font-mono tnum text-ink">
                  {fmt.percent(result.reliability.confirmationRate)}
                </dd>
              </div>
            ) : null}
            {result.reliability.completedSessions ? (
              <div>
                <dt className="inline text-slate">{t('card.completedSessions')} </dt>
                <dd className="inline font-mono tnum text-ink">
                  {fmt.number(result.reliability.completedSessions)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {/* --- Engagement types offered ---------------------------------- */}
        {(result.engagementTypes ?? []).length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {result.engagementTypes.map((type) => (
              <li key={type}>
                <Badge tone="neutral">{t(`booking:engagement.${type}`)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant={inTray ? 'secondary' : 'accent'}
            disabled={!inTray && tray.isFull}
            aria-pressed={inTray}
            onClick={() =>
              tray.toggle({
                tutorId,
                slug: result.slug,
                displayName: result.displayName,
                areaId,
              })
            }
          >
            {inTray ? t('card.inComparison') : t('card.addToComparison')}
          </Button>

          <Link
            to={`/tutors/${result.slug}`}
            className="inline-flex min-h-tap items-center rounded-control border border-slate-line px-4 text-small font-medium text-ink hover:bg-paper"
          >
            {t('card.viewProfile')}
          </Link>
        </div>

        {!inTray && tray.isFull ? (
          <p className="text-caption text-slate">
            <Clock size="sm" className="me-1 inline" />
            {t('card.trayFull', { max: tray.max })}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * The loading placeholder.
 *
 * Deliberately the **same height** as a real card. A skeleton that is shorter
 * than what replaces it produces exactly the layout shift skeletons exist to
 * avoid — the person reaches for a card and the page jumps under their thumb.
 */
export function ResultCardSkeleton() {
  const { t } = useTranslation('common');

  return (
    <div role="status" aria-label={t('state.loading')}>
      <span className="sr-only">{t('state.loading')}</span>
      <Card>
        <CardBody className="space-y-3">
          <div className="h-6 w-2/5 animate-shimmer rounded bg-paper-sunk" />
          <div className="h-3 w-3/5 animate-shimmer rounded bg-paper-sunk" />
          <div className="h-4 w-4/5 animate-shimmer rounded bg-paper-sunk" />
          <div className="h-4 w-3/4 animate-shimmer rounded bg-paper-sunk" />
          <div className="border-t border-slate-line pt-3">
            <div className="h-6 w-1/3 animate-shimmer rounded bg-paper-sunk" />
          </div>
          <div className="h-tap w-1/2 animate-shimmer rounded-control bg-paper-sunk" />
        </CardBody>
      </Card>
    </div>
  );
}
