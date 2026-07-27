/**
 * Rate benchmarking — §6.19, SEC-17, NFR-16.
 *
 * ── The suppression is the feature ─────────────────────────────────────────
 * The server publishes a median only when the cohort reaches four tutors. Below
 * that it returns `null`, and this component renders **nothing** rather than a
 * comparison.
 *
 * That is not caution about statistics. With three tutors in a cell, "above the
 * median" tells you which of three people is dearest — and anyone who knows two
 * of the three now knows the third one's rate. SEC-17 exists to stop a
 * benchmark becoming a way to infer an individual tutor's price, and a client
 * that filled the gap with "based on 3 tutors" would defeat it.
 *
 * So the rule here is simple and absolute: **`benchmarkMedian === null` means
 * show no comparison at all.** Not a placeholder, not a smaller sample, not a
 * greyed-out band. The client never computes a median of its own from the
 * results on screen, which would reconstruct exactly what the server withheld.
 *
 * ── Below / at / above, not a percentage ───────────────────────────────────
 * A parent comparing tutors needs to know whether a rate is ordinary for the
 * area. "18% above median" implies a precision the underlying cohort does not
 * support; three bands do the same job honestly.
 */

import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/Card';
import { useFormat } from '../../lib/format';

/**
 * Within this much of the median counts as "about the same".
 *
 * Ten per cent, because tuition rates are negotiated in round numbers and a
 * band narrower than that would put PKR 1,300 and PKR 1,400 in different
 * categories when no parent would treat them differently.
 */
const AT_MEDIAN_TOLERANCE = 0.1;

export function rateBand(normalisedHourly, benchmarkMedian) {
  // The suppression, honoured at the top of the function.
  if (!benchmarkMedian || !normalisedHourly) return null;

  const ratio = normalisedHourly / benchmarkMedian;
  if (ratio < 1 - AT_MEDIAN_TOLERANCE) return 'below';
  if (ratio > 1 + AT_MEDIAN_TOLERANCE) return 'above';
  return 'at';
}

const BAND_TONE = { below: 'settled', at: 'neutral', above: 'warning' };

/** The inline form, on a result card. */
export function RateBadge({ normalisedHourly, benchmarkMedian }) {
  const { t } = useTranslation('search');
  const band = rateBand(normalisedHourly, benchmarkMedian);

  // Below the cohort threshold there is nothing honest to say.
  if (!band) return null;

  return (
    <Badge tone={BAND_TONE[band]}>{t(`benchmark.band.${band}`)}</Badge>
  );
}

/**
 * The fuller panel, on a profile or a comparison.
 *
 * @param {number|null} props.median Paisa per hour, or null when suppressed.
 */
export function RateBenchmarkPanel({ normalisedHourly, median, areaName, subjectName }) {
  const { t } = useTranslation('search');
  const fmt = useFormat();
  const band = rateBand(normalisedHourly, median);

  if (!median) {
    // Saying *why* there is no benchmark is more useful than silence, and it
    // does not leak anything: "not enough tutors" is true of the cell, not of
    // any tutor in it.
    return (
      <div className="rounded-card border border-slate-line bg-paper p-3">
        <p className="text-caption text-slate">{t('benchmark.suppressed')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-slate-line bg-white p-4">
      <p className="text-caption font-semibold uppercase tracking-wide text-slate">
        {t('benchmark.title')}
      </p>

      <p className="mt-1 text-small text-slate">
        {t('benchmark.context', { subject: subjectName, area: areaName })}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <p className="text-caption text-slate">{t('benchmark.thisTutor')}</p>
          <p className="font-mono text-subtitle tnum text-ink">{fmt.paisa(normalisedHourly)}</p>
        </div>
        <div>
          <p className="text-caption text-slate">{t('benchmark.median')}</p>
          <p className="font-mono text-subtitle tnum text-slate">{fmt.paisa(median)}</p>
        </div>
        {band ? <Badge tone={BAND_TONE[band]}>{t(`benchmark.band.${band}`)}</Badge> : null}
      </div>

      <p className="mt-3 text-caption text-slate">{t('benchmark.note')}</p>
    </div>
  );
}
