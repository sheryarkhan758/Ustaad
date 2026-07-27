/**
 * Side-by-side comparison — §6.18.
 *
 * ── Why the tray stores ids and this view refetches ────────────────────────
 * The tray persists across navigation and across days (localStorage), so what
 * it holds must be the things that do not change: id, slug, name, area. Rates,
 * verification state and reliability all change, and a comparison showing a
 * price from four days ago would be quietly wrong about the one number the
 * parent is actually comparing on.
 *
 * ── Rows, not cards ────────────────────────────────────────────────────────
 * The whole point is reading *across*. Three cards side by side make you scan
 * up and down to find the same field three times; a table with one row per
 * dimension puts the three values on one line, which is what "compare" means.
 *
 * At 360px the table scrolls horizontally inside its own container with the
 * dimension column pinned, so the label stays visible while the values move.
 *
 * ── Every figure is the server's ───────────────────────────────────────────
 * Normalised rates, benchmark medians, per-topic verdicts and reliability all
 * arrive computed. This view arranges them; it derives nothing — and in
 * particular it does **not** compute a median across the three tutors on
 * screen, which would reconstruct what SEC-17 suppressed.
 */

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Badge, Card, CardBody, EmptyState, Skeleton } from '../ui/Card';
import { Check, Close, Warning } from '../ui/Icon';
import { RateBadge } from './RateBenchmark';
import { useComparisonTray } from '../../context/ComparisonTrayContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/** One row of the comparison. */
function Row({ label, children, note }) {
  return (
    <tr className="border-b border-slate-line align-top">
      <th
        scope="row"
        // Pinned, so the dimension stays readable while the values scroll.
        className="sticky start-0 z-10 bg-white py-3 pe-4 text-start text-caption font-semibold uppercase tracking-wide text-slate"
      >
        {label}
        {note ? <span className="mt-0.5 block font-normal normal-case text-slate">{note}</span> : null}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children, className = '' }) {
  return <td className={`min-w-[9rem] py-3 pe-4 text-small text-ink ${className}`}>{children}</td>;
}

export function ComparisonView() {
  const { t } = useTranslation(['search', 'booking', 'common']);
  const fmt = useFormat();
  const tray = useComparisonTray();

  const slugs = tray.items.map((item) => item.slug);

  /**
   * Refetched, never read from the tray. See the header.
   */
  const query = useQuery({
    queryKey: ['comparison', [...slugs].sort().join(',')],
    queryFn: async () => {
      const loaded = await Promise.all(
        slugs.map((slug) => api.get(`/tutors/${slug}`).catch(() => null)),
      );
      return loaded.filter(Boolean).map((payload) => payload.tutor ?? payload);
    },
    enabled: slugs.length > 0,
    staleTime: 60 * 1000,
  });

  if (tray.count === 0) {
    return (
      <EmptyState
        title={t('compare.emptyTitle')}
        description={t('compare.emptyBody', { max: tray.max })}
      />
    );
  }

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('common:state.loading')} className="space-y-2">
        <span className="sr-only">{t('common:state.loading')}</span>
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const tutors = query.data ?? [];

  /**
   * Availability overlap — the one place this view combines data.
   *
   * It is a set intersection over slots the server already returned, not a
   * derived statistic: "all three are free on Monday evening" is a fact about
   * the three lists, and computing it here saves a round trip without inventing
   * a figure.
   */
  const overlap = tutors.length > 1
    ? tutors
        .map((tutor) =>
          new Set((tutor.availability ?? []).map((slot) => `${slot.weekday}|${slot.startTime}`)),
        )
        .reduce((shared, next) => new Set([...shared].filter((key) => next.has(key))))
    : new Set();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-title text-ink">
          {t('compare.title', { count: tutors.length })}
        </h2>
        <Button size="sm" variant="ghost" onClick={tray.clear}>
          {t('common:action.clear')}
        </Button>
      </div>

      <Card>
        <CardBody>
          <div tabIndex={0} role="region" aria-label={t('compare.title', { count: tutors.length })} className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <caption className="sr-only">{t('compare.caption')}</caption>
              <thead>
                <tr className="border-b-2 border-slate-line">
                  <th scope="col" className="sticky start-0 bg-white pb-3 pe-4 text-start">
                    <span className="sr-only">{t('compare.dimension')}</span>
                  </th>
                  {tutors.map((tutor) => (
                    <th key={tutor.id} scope="col" className="min-w-[9rem] pb-3 pe-4 text-start">
                      <Link
                        to={`/tutors/${tutor.slug}`}
                        className="font-display text-subtitle text-ink hover:text-verdigris-deep hover:underline"
                      >
                        {tutor.displayName}
                      </Link>
                      <button
                        type="button"
                        onClick={() => tray.remove(tutor.id)}
                        aria-label={t('compare.remove', { name: tutor.displayName })}
                        className="ms-2 align-middle text-slate hover:text-flag"
                      >
                        <Close size="sm" />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {/* The normalised basis — the whole reason this view exists. */}
                <Row label={t('compare.rate')} note={t('compare.rateNote')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      {tutor.normalisedHourly ? (
                        <>
                          <span className="font-mono tnum">{fmt.paisa(tutor.normalisedHourly)}</span>
                          <span className="block">
                            <RateBadge
                              normalisedHourly={tutor.normalisedHourly}
                              benchmarkMedian={tutor.benchmarkMedian}
                            />
                          </span>
                        </>
                      ) : (
                        <span className="text-slate">{t('card.noRate')}</span>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label={t('compare.verification')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      <ul className="space-y-1">
                        {(tutor.verifiedArtefacts ?? []).map((artefact) => (
                          <li key={artefact} className="flex items-center gap-1.5 text-caption">
                            <Check size="sm" className="text-verdigris-deep" />
                            {t(`card.artefact.${artefact}`, { defaultValue: artefact })}
                          </li>
                        ))}
                      </ul>
                      {/* The limit of the claim, in the comparison too. */}
                      <p className="mt-1 text-caption text-slate">{t('compare.noBackgroundCheck')}</p>
                    </Cell>
                  ))}
                </Row>

                <Row label={t('compare.competency')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      {(tutor.competency ?? []).length === 0 ? (
                        <span className="text-caption text-slate">{t('compare.noCompetency')}</span>
                      ) : (
                        <ul className="space-y-1">
                          {tutor.competency.map((verdict) => (
                            <li key={verdict.topicId}>
                              <Badge tone={verdict.status === 'expired' ? 'warning' : 'info'}>
                                {verdict.status === 'expired' ? <Warning size="sm" /> : <Check size="sm" />}
                                {verdict.topicName ?? verdict.topicId}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label={t('compare.reliability')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      {tutor.reliability?.confirmationRate !== undefined &&
                      tutor.reliability?.confirmationRate !== null ? (
                        <span className="font-mono tnum">
                          {fmt.percent(tutor.reliability.confirmationRate)}
                        </span>
                      ) : (
                        <span className="text-slate">—</span>
                      )}
                    </Cell>
                  ))}
                </Row>

                <Row label={t('compare.availability')} note={t('compare.availabilityNote')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      <span className="font-mono tnum">
                        {t('compare.slotCount', { count: (tutor.availability ?? []).length })}
                      </span>
                    </Cell>
                  ))}
                </Row>

                <Row label={t('compare.engagement')}>
                  {tutors.map((tutor) => (
                    <Cell key={tutor.id}>
                      <ul className="flex flex-wrap gap-1">
                        {(tutor.engagementTypes ?? []).map((type) => (
                          <li key={type}>
                            <Badge tone="neutral">{t(`booking:engagement.${type}`)}</Badge>
                          </li>
                        ))}
                      </ul>
                    </Cell>
                  ))}
                </Row>
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* The overlap, stated once rather than repeated in every column. */}
      {tutors.length > 1 ? (
        <Card>
          <CardBody>
            <h3 className="font-display text-subtitle text-ink">{t('compare.overlapTitle')}</h3>
            <p className="mt-1 text-small text-slate">
              {overlap.size > 0
                ? t('compare.overlapBody', { count: overlap.size })
                : t('compare.overlapNone')}
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
