/**
 * Reviews and their intelligence output — §6.9, FR-9.4 to FR-9.8, SEC-9.
 *
 * ── Three rules, and they are not the same rule ────────────────────────────
 *
 *  1. **A safety-flagged review is absent.** Not redacted, not collapsed, not
 *     marked "under review" — absent. Any of those would tell the tutor a
 *     report exists, and SEC-9 says she is never automatically notified. The
 *     server's `listPublicReviewsForTutor` excludes them, so this component
 *     never receives one; there is deliberately no branch here for the case.
 *
 *  2. **A generic review is shown, and marked.** FR-9.6 down-weights it in
 *     ranking and never hides it. Conflating "counts for less" with "is not
 *     shown" would quietly delete the reviews of people who wrote briefly —
 *     which correlates with people who write in a second language, on a phone,
 *     in a hurry. The marking says what it is: little detail, still real.
 *
 *  3. **A contradiction is surfaced publicly.** FR-9.7. Where the stars and the
 *     words disagree, the words are what a careful reader would want. The
 *     rating is **never altered** — the reviewer's five stars stay five stars,
 *     and the disagreement is shown beside them.
 *
 * ── The eight dimensions carry quoted evidence ─────────────────────────────
 * Each dimension shows the reviewer's own words, quoted, not the model's
 * summary of them. That is what makes the analysis checkable: a parent can see
 * the sentence a score was drawn from and disagree with the reading.
 *
 * Text is rendered through `UserText`, verbatim, never translated (§2.10).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, Card, CardBody, EmptyState } from '../ui/Card';
import { Warning } from '../ui/Icon';
import { UserQuote, UserText } from '../ui/UserText';
import { useFormat } from '../../lib/format';

/** The eight, in the order `shared/review-analysis.ts` defines them. */
const DIMENSION_ORDER = [
  'punctuality',
  'teaching_quality',
  'syllabus_command',
  'confidence_change',
  'communication',
  'pace',
  'consistency',
  'value_for_money',
];

function Stars({ rating }) {
  const { t } = useTranslation('search');
  return (
    <span className="font-mono text-small tnum text-ink" aria-label={t('reviews.starsLabel', { rating })}>
      <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
    </span>
  );
}

function DimensionRow({ dimension }) {
  const { t } = useTranslation('search');
  if (!dimension || dimension.score === 0) return null;

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-caption font-medium text-ink">
          {t(`reviews.dimension.${dimension.key}`, { defaultValue: dimension.key })}
        </span>
        <span className="font-mono text-caption tnum text-slate">{dimension.score}/5</span>
      </div>

      {/*
        The reviewer's own sentence, quoted. Without this the score is the
        model's opinion with nothing to check it against.
      */}
      {dimension.evidence ? (
        <UserQuote className="mt-1 text-caption">{dimension.evidence}</UserQuote>
      ) : null}
    </li>
  );
}

function ReviewCard({ review }) {
  const { t } = useTranslation(['search', 'common']);
  const fmt = useFormat();
  const [expanded, setExpanded] = useState(false);

  const dimensions = (review.dimensions ?? [])
    .slice()
    .sort((a, b) => DIMENSION_ORDER.indexOf(a.key) - DIMENSION_ORDER.indexOf(b.key));

  const hasEvidence = dimensions.some((dimension) => dimension.evidence);

  return (
    <li>
      <Card
        className={[
          // The low-signal marking is structural as well as textual: a
          // lighter, dashed card reads as "less to go on" at a glance, and
          // survives greyscale. It is never hidden.
          review.lowSignal ? 'border-dashed bg-paper/50' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Stars rating={review.rating} />
              <span className="font-mono text-caption tnum text-slate">
                {fmt.date(review.createdAt)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {/* FR-9.5 — a review from someone with 40 sessions is worth more
                  context than one from someone with 1. */}
              {review.completedSessions > 0 ? (
                <Badge tone="neutral">
                  {t('reviews.sessionsWith', { count: review.completedSessions })}
                </Badge>
              ) : null}

              {review.lowSignal ? <Badge tone="neutral">{t('reviews.lowSignal')}</Badge> : null}

              {review.contradiction ? (
                <Badge tone="warning">
                  <Warning size="sm" />
                  {t('reviews.contradiction')}
                </Badge>
              ) : null}
            </div>
          </div>

          {/*
            FR-9.7 — the disagreement explained, beside a rating that has not
            been touched.
          */}
          {review.contradiction ? (
            <p className="rounded-control border border-seal/30 bg-seal-soft px-3 py-2 text-caption text-ink">
              {t('reviews.contradictionExplain')}
            </p>
          ) : null}

          {review.lowSignal ? (
            <p className="text-caption text-slate">{t('reviews.lowSignalExplain')}</p>
          ) : null}

          {review.text ? <UserText className="text-small text-ink">{review.text}</UserText> : null}

          {review.analysisStatus === 'unanalysed' ? (
            // A malformed model response is retried once, then the record is
            // marked `unanalysed` and the work moves on — the review is never
            // lost. Saying so is better than a silently bare card.
            <p className="text-caption text-slate">{t('reviews.notAnalysed')}</p>
          ) : null}

          {hasEvidence ? (
            <div>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((open) => !open)}
                className="min-h-tap text-small font-medium text-verdigris-deep underline underline-offset-2"
              >
                {expanded ? t('reviews.hideBreakdown') : t('reviews.showBreakdown')}
              </button>

              {expanded ? (
                <ul className="mt-2 divide-y divide-slate-line border-t border-slate-line">
                  {dimensions.map((dimension) => (
                    <DimensionRow key={dimension.key} dimension={dimension} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </li>
  );
}

export function ReviewList({ reviews = [] }) {
  const { t } = useTranslation('search');

  if (reviews.length === 0) {
    return <EmptyState title={t('reviews.emptyTitle')} description={t('reviews.emptyBody')} />;
  }

  const lowSignalCount = reviews.filter((review) => review.lowSignal).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-subtitle text-ink">
          {t('reviews.title', { count: reviews.length })}
        </h2>
      </div>

      {/*
        Said once, above the list: why some cards look thinner. Without it the
        dashed border reads as a defect rather than as information.
      */}
      {lowSignalCount > 0 ? (
        <p className="text-caption text-slate">
          {t('reviews.lowSignalNote', { count: lowSignalCount })}
        </p>
      ) : null}

      <p className="text-caption text-slate">{t('reviews.basisNote')}</p>

      <ul className="space-y-3">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </div>
  );
}
