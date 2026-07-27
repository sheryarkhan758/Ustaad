/**
 * Why this tutor ranked where she did — §6.22, FR-22.4.
 *
 * ── The framing is the point ───────────────────────────────────────────────
 * This narration explains a **deterministic score**. It is not the platform's
 * opinion of a tutor, and it must not read like one. `shared/ranking.ts`
 * computes a weighted sum over materialised columns; the same inputs give the
 * same number every time, and a second family running the same search sees the
 * same order.
 *
 * The model's only job is to say that arithmetic in a sentence. It is handed a
 * breakdown it did not compute and **may introduce no figure that is not in
 * that breakdown** — a narration that does is discarded and the raw breakdown
 * shown instead (FR-22.4). So the heading says "how this was calculated", the
 * note says the score is reproducible, and the breakdown is always available
 * underneath.
 *
 * ── Only shown when the profile was reached from a search ──────────────────
 * A rank is a property of a result set, not of a person. Opening a shared link
 * to a tutor and being told she "ranked third" is meaningless — third of what?
 * So the component renders nothing without a `searchContext`.
 *
 * ── It degrades ───────────────────────────────────────────────────────────
 * If the narration call fails, is out of budget, or comes back unparseable, the
 * breakdown table stands on its own (NFR-11). The figures were never the
 * model's to produce.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { Card, CardBody, Table, Td, Th } from '../ui/Card';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

/** Human labels for the breakdown keys `shared/ranking.ts` emits. */
const FACTOR_KEY = {
  topicCoverage: 'ranking.factor.topicCoverage',
  reviewCredibility: 'ranking.factor.reviewCredibility',
  reliability: 'ranking.factor.reliability',
  verificationRecency: 'ranking.factor.verificationRecency',
  ratePosition: 'ranking.factor.ratePosition',
  proximity: 'ranking.factor.proximity',
};

export function RankingNarration({ tutorId, searchContext }) {
  const { t, i18n } = useTranslation(['search', 'common']);
  const fmt = useFormat();
  const [showBreakdown, setShowBreakdown] = useState(false);

  // A rank is a property of a result set. Without one there is nothing to
  // explain, and inventing a position would be worse than silence.
  const enabled = Boolean(tutorId && searchContext?.topicId);

  const narration = useQuery({
    queryKey: ['narration', tutorId, searchContext?.topicId, i18n.resolvedLanguage],
    queryFn: () => api.get(`/ai/narration/${tutorId}/${searchContext.topicId}`),
    enabled,
    // The narration is cached on a score hash server-side, so a refetch buys
    // nothing and costs a request.
    staleTime: Infinity,
    retry: false,
  });

  if (!enabled) return null;

  const breakdown = narration.data?.breakdown;
  const text = narration.data?.narration;

  // Nothing came back and nothing was cached — the breakdown alone is still
  // worth showing, and is the part that was never the model's anyway.
  if (narration.isError && !breakdown) return null;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <h2 className="font-display text-subtitle text-ink">{t('ranking.title')}</h2>
          {/*
            The framing sentence. This is a calculation, not a recommendation,
            and the difference is the whole of §2.9.
          */}
          <p className="mt-0.5 text-caption text-slate">{t('ranking.deterministicNote')}</p>
        </div>

        {narration.isPending ? (
          <div role="status" aria-label={t('common:state.loading')}>
            <span className="sr-only">{t('common:state.loading')}</span>
            <div className="h-4 w-full animate-shimmer rounded bg-paper-sunk" />
            <div className="mt-2 h-4 w-4/5 animate-shimmer rounded bg-paper-sunk" />
          </div>
        ) : text ? (
          <p className="text-small text-ink">{text}</p>
        ) : (
          // The degraded path: no sentence, but the arithmetic is intact.
          <p className="text-small text-slate">{t('ranking.narrationUnavailable')}</p>
        )}

        {breakdown ? (
          <div>
            <button
              type="button"
              aria-expanded={showBreakdown}
              onClick={() => setShowBreakdown((open) => !open)}
              className="min-h-tap text-small font-medium text-verdigris-deep underline underline-offset-2"
            >
              {showBreakdown ? t('ranking.hideBreakdown') : t('ranking.showBreakdown')}
            </button>

            {showBreakdown ? (
              <div className="mt-2">
                <Table caption={t('ranking.breakdownCaption')}>
                  <thead>
                    <tr>
                      <Th>{t('ranking.factor.heading')}</Th>
                      <Th numeric>{t('ranking.contribution')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(breakdown)
                      .filter(([, value]) => typeof value === 'number')
                      .map(([key, value]) => (
                        <tr key={key}>
                          <Td>{t(FACTOR_KEY[key] ?? 'ranking.factor.other', { defaultValue: key })}</Td>
                          <Td numeric>{fmt.percent(value)}</Td>
                        </tr>
                      ))}
                  </tbody>
                </Table>

                <p className="mt-2 text-caption text-slate">{t('ranking.breakdownNote')}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
