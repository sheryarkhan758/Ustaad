/**
 * Reliability statistics — §6.17, SEC-21.
 *
 * ── Choosing the form ──────────────────────────────────────────────────────
 * Three rates, each a percentage of a whole. The data's job is **magnitude
 * comparison across three named things**, which is a bar chart — horizontal,
 * because the category names are words rather than dates and reading them
 * along a vertical axis is easier than tilting them under a horizontal one.
 *
 * It is a **single series**, so there is no legend: the title names what is
 * being measured, and each bar is directly labelled with its own figure. A
 * legend box for one series is furniture.
 *
 * Colour is therefore a single hue rather than a categorical palette. The
 * categorical checks (lightness band, chroma floor) exist to keep hues apart
 * from each other and do not apply to one hue; the check that does apply —
 * contrast against the surface — passes at ≥ 3:1 for `verdigris`.
 *
 * ── The fairness note is part of the chart, not a footnote ─────────────────
 * SEC-21: declines a tutor makes under a **declared safety constraint** are
 * excluded from her confirmation rate. That is not a detail — it is the reason
 * a woman can set those constraints without watching her public statistics
 * fall, and a figure shown without it invites exactly the inference the rule
 * exists to prevent. So it sits under the chart in normal-sized text.
 *
 * ── Every figure is the server's ───────────────────────────────────────────
 * These come from `tutor_reliability`, materialised by a job. Nothing here is
 * computed from bookings on the client (§2.8).
 */

import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardBody } from '../ui/Card';
import { useFormat } from '../../lib/format';

/** Single series, single hue. See the header. */
const BAR = '#0F7B8A';
/** Recessive — the track a bar sits in, not a second series. */
const TRACK = '#E7ECF1';

/**
 * Below this many completed engagements the rates are noise.
 *
 * Three sessions and one decline is a 75% confirmation rate, which reads as a
 * judgement about a person and is really a judgement about a small number. The
 * same reasoning as the SEC-17 rate-benchmark suppression, applied to a
 * tutor's own statistics.
 */
const MIN_SAMPLE = 5;

function ReliabilityTooltip({ active, payload, t, fmt }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-control border border-slate-line bg-white px-3 py-2 shadow-raised">
      <p className="text-caption font-semibold text-ink">{row.label}</p>
      <p className="font-mono text-small tnum text-ink">{fmt.percent(row.value / 100)}</p>
      <p className="mt-1 max-w-[16rem] text-caption text-slate">{t(row.explainKey)}</p>
    </div>
  );
}

export function ReliabilityChart({ reliability }) {
  const { t } = useTranslation(['search', 'common']);
  const fmt = useFormat();

  const sample = reliability?.completedSessions ?? 0;

  if (!reliability || sample < MIN_SAMPLE) {
    return (
      <Card>
        <CardBody>
          <h2 className="font-display text-subtitle text-ink">{t('reliability.title')}</h2>
          <p className="mt-2 text-small text-slate">
            {t('reliability.tooFewSessions', { count: MIN_SAMPLE })}
          </p>
        </CardBody>
      </Card>
    );
  }

  const data = [
    {
      key: 'confirmation',
      label: t('reliability.confirmation'),
      value: Math.round((reliability.confirmationRate ?? 0) * 100),
      explainKey: 'reliability.confirmationExplain',
    },
    {
      key: 'onTime',
      label: t('reliability.onTime'),
      value: Math.round((reliability.onTimeRate ?? 0) * 100),
      explainKey: 'reliability.onTimeExplain',
    },
    {
      key: 'completion',
      label: t('reliability.completion'),
      value: Math.round((reliability.completionRate ?? 0) * 100),
      explainKey: 'reliability.completionExplain',
    },
  ];

  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          {/* The title names the series, which is why there is no legend. */}
          <h2 className="font-display text-subtitle text-ink">{t('reliability.title')}</h2>
          <p className="mt-0.5 text-caption text-slate">
            {t('reliability.basedOn', { count: sample })}
          </p>
        </div>

        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
              barCategoryGap="28%"
            >
              {/* Domain pinned to 0–100: a percentage axis that autoscales
                  makes 60% look like a full bar. */}
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={104}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#5A6E7F', fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: 'rgba(27,58,87,0.04)' }}
                content={<ReliabilityTooltip t={t} fmt={fmt} />}
              />
              <Bar
                dataKey="value"
                // 4px rounded data-end, anchored square to the baseline.
                radius={[0, 4, 4, 0]}
                barSize={14}
                background={{ fill: TRACK, radius: 4 }}
                isAnimationActive={false}
              >
                {data.map((row) => (
                  <Cell key={row.key} fill={BAR} />
                ))}
                {/* Direct labels — three bars, so every one is labelled and
                    no axis of numbers is needed. Text wears an ink token, not
                    the series colour. */}
                <LabelList
                  dataKey="value"
                  position="right"
                  formatter={(value) => `${value}%`}
                  fill="#1B3A57"
                  fontSize={12}
                  className="tnum"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/*
          The table view. Identity is never colour-alone, and a screen reader
          gets the figures rather than an inaccessible SVG.
        */}
        <table className="sr-only">
          <caption>{t('reliability.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('reliability.measure')}</th>
              <th scope="col">{t('reliability.value')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>{fmt.percent(row.value / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/*
          SEC-21, at normal size rather than as fine print. This is the sentence
          that lets a tutor use her safety constraints without fear.
        */}
        <p className="rounded-control border border-verdigris/25 bg-verdigris-soft px-3 py-2 text-small text-ink">
          {t('reliability.safetyExclusion')}
        </p>
      </CardBody>
    </Card>
  );
}
