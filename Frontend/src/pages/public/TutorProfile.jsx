/**
 * The public tutor profile — §6.4, §6.17, §6.21, §6.22.
 *
 * Canonical at **`/t/:slug`** — the clean URL a QR code encodes and a tutor
 * prints. `/tutors/:slug` still resolves for anything already linking there.
 *
 * ── Anonymous, and server-data-driven ──────────────────────────────────────
 * No account required (FR-1.6). Every figure on the page — the normalised
 * rates, the benchmark, the reliability percentages, the ranking breakdown —
 * arrives already computed from materialised columns. The client arranges;
 * it does not calculate (§2.8).
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No street address, ever. Area is the finest granularity in this product and
 * a public profile shows nothing beyond it (SEC-3). No safety-flagged review:
 * the server excludes those from the public listing and this page has no
 * branch that could render one.
 */

import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { UserText } from '../../components/ui/UserText';
import { BookingOptions } from '../../components/profile/BookingOptions';
import { RankingNarration } from '../../components/profile/RankingNarration';
import { ReviewList } from '../../components/profile/ReviewList';
import { RateBenchmarkPanel } from '../../components/search/RateBenchmark';
import {
  CompetencyRecord,
  IdentityRecord,
} from '../../components/verification/VerificationRecord';
import { useComparisonTray } from '../../context/ComparisonTrayContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { keys } from '../../lib/queryClient';
import { useAreas, useLocalName } from '../../lib/reference';

/*
 * Recharts and `qrcode` are the two heaviest dependencies in the client and
 * neither is above the fold. Loading them with the page put a public,
 * anonymous, frequently-shared route over 400 kB — which on the connection a
 * mother in Sukkur actually has is the difference between a profile that opens
 * and one she gives up on. Split out, the page shell arrives first and the
 * chart and the QR follow.
 */
const ReliabilityChart = lazy(() =>
  import('../../components/profile/ReliabilityChart').then((m) => ({ default: m.ReliabilityChart })),
);
const ShareProfile = lazy(() =>
  import('../../components/profile/ShareProfile').then((m) => ({ default: m.ShareProfile })),
);

function RateTable({ rates }) {
  const { t } = useTranslation(['search', 'tutor']);
  const fmt = useFormat();

  if (rates.length === 0) return null;

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[26rem] border-collapse text-start">
        <caption className="sr-only">{t('tutor:rates.title')}</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-slate-line pb-2 pe-4 text-caption font-semibold uppercase tracking-wide text-slate">
              {t('tutor:rates.rateType')}
            </th>
            <th scope="col" className="border-b border-slate-line pb-2 pe-4 text-caption font-semibold uppercase tracking-wide text-slate">
              {t('tutor:rates.mode')}
            </th>
            <th scope="col" className="border-b border-slate-line pb-2 pe-4 text-end text-caption font-semibold uppercase tracking-wide text-slate">
              {t('tutor:rates.amount')}
            </th>
            <th scope="col" className="border-b border-slate-line pb-2 text-end text-caption font-semibold uppercase tracking-wide text-slate">
              {t('tutor:rates.comparableShort')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <tr key={rate.id}>
              <td className="border-b border-slate-line py-3 pe-4 text-small text-ink">
                {t(`tutor:rates.${rate.rateType}`)}
                {rate.negotiable ? (
                  <Badge tone="neutral" className="ms-2">
                    {t('tutor:rates.negotiableShort')}
                  </Badge>
                ) : null}
              </td>
              <td className="border-b border-slate-line py-3 pe-4 text-small text-ink">
                {t(`mode.${rate.mode}`)}
              </td>
              <td className="border-b border-slate-line py-3 pe-4 text-end font-mono text-small tnum text-ink">
                {fmt.paisa(rate.amount)}
              </td>
              {/* The comparable figure, beside the stated one — §2.7. */}
              <td className="border-b border-slate-line py-3 text-end font-mono text-small tnum text-slate">
                {fmt.paisa(rate.normalisedHourlyAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-caption text-slate">{t('tutor:rates.comparableNote')}</p>
    </div>
  );
}

export default function TutorProfile() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { t } = useTranslation(['search', 'tutor', 'common']);
  const localName = useLocalName();
  const tray = useComparisonTray();

  const profile = useQuery({
    queryKey: keys.tutor(slug),
    queryFn: () => api.get(`/tutors/public/${slug}`),
    enabled: Boolean(slug),
  });

  const reviews = useQuery({
    queryKey: keys.reviews(profile.data?.tutor?.id),
    queryFn: async () => (await api.get(`/reviews/tutor/${profile.data.tutor.id}`))?.reviews ?? [],
    enabled: Boolean(profile.data?.tutor?.id),
  });

  // Areas are reference data, cached indefinitely. Named rather than shown as
  // slugs, and in Urdu where a name exists for it.
  const areas = useAreas(profile.data?.tutor?.cityId);

  if (profile.isPending) {
    return (
      <div className="mx-auto max-w-wide space-y-4 px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={profile.error} onRetry={profile.refetch} />
      </div>
    );
  }

  const {
    tutor,
    verification,
    claims = [],
    rates = [],
    availability = [],
    reliability = null,
    normalisedHourly = null,
    benchmarkMedian = null,
  } = profile.data ?? {};
  if (!tutor) return null;

  /*
   * Area, never a street (SEC-3). A tutor states the areas she will travel
   * to; the profile names them and stops there. There is no map on this page
   * and no coordinate behind it — §4.2 puts GPS permanently out of scope.
   */
  const inTray = tray.has(tutor.id);

  /*
   * The areas she will travel to, named. This is the finest location this
   * product has — no street, no pin, no coordinate (SEC-3, §4.2).
   */
  const areaNames = (tutor.willingAreaIds ?? [])
    .map((id) => (areas.data ?? []).find((area) => area.id === id))
    .filter(Boolean)
    .map((area) => localName(area));

  // Verified topics carry a date and an expiry; asserted ones carry neither
  // and must never be rendered as a verification (§2.5).
  const verifiedClaims = claims.filter((claim) => claim.claimStatus === 'verified');
  const assertedClaims = claims.filter((claim) => claim.claimStatus !== 'verified');

  const deliveryModes = [
    tutor.teachesAtHome ? 'home' : null,
    tutor.teachesOnline ? 'online' : null,
    tutor.teachesAtOwnPlace ? 'own_place' : null,
  ].filter(Boolean);

  /** Set when the profile was reached from a search — see RankingNarration. */
  const searchContext = params.get('topicId') ? { topicId: params.get('topicId') } : null;

  return (
    <div className="mx-auto max-w-wide px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* --- Identity ---------------------------------------------- */}
          <header className="flex flex-wrap items-start gap-4">
            <div
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ink text-title text-white"
            >
              {tutor.displayName?.[0] ?? '?'}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="font-display text-display text-ink">{tutor.displayName}</h1>

              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-slate">
                {areaNames.length > 0 ? (
                  <span>
                    {areaNames.map((name, index) => (
                      <span key={name.text} lang={name.lang}>
                        {index > 0 ? '، ' : ''}
                        {name.text}
                      </span>
                    ))}
                  </span>
                ) : null}
                {tutor.experienceYears ? (
                  <span className="tnum">
                    {t('card.experience', { count: tutor.experienceYears })}
                  </span>
                ) : null}
              </p>

              {/* She typed this herself, in whichever script she chose. */}
              {tutor.qualifications ? (
                <UserText className="mt-1 text-small text-ink">{tutor.qualifications}</UserText>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {/* FR-33.10 — never a substitute for verification. */}
                {tutor.volunteer ? <Badge tone="settled">{t('card.volunteer')}</Badge> : null}
                {deliveryModes.map((mode) => (
                  <Badge key={mode} tone="neutral">
                    {t(`mode.${mode}`)}
                  </Badge>
                ))}
              </div>
            </div>

            <Button
              variant={inTray ? 'secondary' : 'accent'}
              disabled={!inTray && tray.isFull}
              aria-pressed={inTray}
              onClick={() =>
                tray.toggle({
                  tutorId: tutor.id,
                  slug: tutor.slug,
                  displayName: tutor.displayName,
                  areaId: tutor.willingAreaIds?.[0] ?? null,
                })
              }
            >
              {inTray ? t('card.inComparison') : t('card.addToComparison')}
            </Button>
          </header>

          {/* Biographies, verbatim and never translated (§2.10). */}
          {tutor.bio ? (
            <UserText className="text-body text-ink" lang="en">
              {tutor.bio}
            </UserText>
          ) : null}
          {tutor.bioUr ? (
            <UserText className="font-urdu text-urdu-body text-ink" lang="ur">
              {tutor.bioUr}
            </UserText>
          ) : null}

          {/* --- Ranking narration, only from a search ------------------ */}
          <RankingNarration tutorId={tutor.id} searchContext={searchContext} />

          {/* --- Verification: the itemised record --------------------- */}
          <section className="space-y-4">
            <h2 className="font-display text-subtitle text-ink">{t('tutor:verification.title')}</h2>

            {/* Identity: administrator-checked, itemised by artefact (FR-6.5). */}
            {verification?.verifiedOn ? (
              <IdentityRecord
                artefacts={(verification.artefactsChecked ?? []).map((artefact) => ({
                  artefact,
                  checkedOn: verification.verifiedOn,
                }))}
                decidedBy={verification.verifiedBy}
                decidedAt={verification.verifiedOn}
              />
            ) : null}

            {/*
              Competency: a separate track, per topic, AI-assessed. The two are
              never merged into one badge (FR-6.2) — which is why they are two
              components with two headings rather than a combined list.
            */}
            {verifiedClaims.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {verifiedClaims.map((claim) => (
                  <CompetencyRecord
                    key={claim.id}
                    topic={[claim.subjectName, claim.levelName].filter(Boolean).join(' — ')}
                    outcome="passed"
                    assessedAt={claim.verifiedAt}
                    expiresOn={claim.expiresOn}
                  />
                ))}
              </div>
            ) : (
              <p className="text-small text-slate">{t('reviews.noCompetencyYet')}</p>
            )}

            {/*
              What she says she teaches, kept visually distinct from what was
              tested. Dashed, no seal, and the words "not yet tested" — an
              asserted claim rendered like a verified one is the single most
              damaging thing this page could do (§2.5).
            */}
            {assertedClaims.length > 0 ? (
              <div>
                <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
                  {t('tutor:claims.assertedHeading')}
                </h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {assertedClaims.map((claim) => (
                    <li
                      key={claim.id}
                      className="rounded-control border border-dashed border-slate-line px-2.5 py-1 text-caption text-slate"
                    >
                      {[claim.subjectName, claim.levelName, claim.boardName]
                        .filter(Boolean)
                        .join(' · ')}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-caption text-slate">
                  {t('tutor:claims.assertedNote')}
                </p>
              </div>
            ) : null}
          </section>

          {/* --- Rates -------------------------------------------------- */}
          <section className="space-y-3">
            <h2 className="font-display text-subtitle text-ink">{t('tutor:rates.title')}</h2>
            <RateTable rates={rates} />
            <RateBenchmarkPanel
              normalisedHourly={normalisedHourly}
              median={benchmarkMedian}
              areaName={areaNames[0]?.text}
              subjectName={claims[0]?.subjectName}
            />
          </section>

          {/* --- Reliability -------------------------------------------- */}
          <Suspense fallback={<SkeletonCard label={t('common:state.loading')} />}>
            <ReliabilityChart reliability={reliability} />
          </Suspense>

          {/* --- Availability summary ----------------------------------- */}
          {availability.length > 0 ? (
            <Card>
              <CardBody>
                <h2 className="font-display text-subtitle text-ink">
                  {t('tutor:availability.caption')}
                </h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {availability.map((slot) => (
                    <li key={`${slot.weekday}-${slot.startTime}`}>
                      <Badge tone="neutral">
                        {t(`tutor:availability.weekday.${slot.weekday}`)} {slot.startTime}–
                        {slot.endTime}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          {/* --- Booking ------------------------------------------------ */}
          <BookingOptions tutor={tutor} rates={rates} />

          {/* --- Reviews ------------------------------------------------ */}
          <section>
            {reviews.isPending ? (
              <SkeletonCard label={t('common:state.loading')} />
            ) : (
              <ReviewList reviews={reviews.data ?? []} />
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <Suspense fallback={<SkeletonCard label={t('common:state.loading')} />}>
            <ShareProfile slug={tutor.slug} displayName={tutor.displayName} />
          </Suspense>

          {/* SEC-3, said where somebody might wonder. */}
          <p className="text-caption text-slate print:hidden">{t('profile.areaOnlyNote')}</p>

          <Link
            to="/search"
            className="inline-flex min-h-tap items-center text-small font-medium text-verdigris-deep underline underline-offset-2 print:hidden"
          >
            {t('profile.backToSearch')}
          </Link>
        </aside>
      </div>
    </div>
  );
}
