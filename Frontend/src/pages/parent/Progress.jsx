/**
 * The progress ledger — §6.12.
 *
 * ── Who this page is for, and what that changes ────────────────────────────
 * A parent paying fifteen thousand rupees a month has, in the informal market,
 * no evidence of progress beyond the tutor's own reassurance (§2.8). This is
 * the answer to that, and the audience decides the design: it is what a parent
 * holds up to a relative who asked whether the money is doing anything.
 *
 * So it is built to read as a **record**, not a dashboard. No gauges, no
 * percentage-complete rings, no score out of a hundred the platform invented.
 * Every figure here is a rating a named, verified tutor wrote down after a
 * session, and the page says whose it is. Analytics chrome would imply the
 * platform measured the child; it did not, and it must not appear to.
 *
 * ── Read on a phone, in a hallway ──────────────────────────────────────────
 * One column throughout, charts sized for a narrow viewport rather than scaled
 * down from a desktop layout, and the summary figures first so the answer to
 * "is it working" survives without scrolling.
 *
 * ── Right-to-left is a data-direction problem, not a CSS one ───────────────
 * Flipping the page with `dir="rtl"` does not flip a chart. Recharts plots in
 * its own coordinate space, so an Urdu reader would get a time axis running the
 * wrong way — earliest session on the right, in a layout the eye reads
 * right-to-left. `reversed` on the value axis and `orientation="right"` on the
 * other are what actually turn a chart around, and both follow the active
 * language (§6.27, NFR-17). The chart wrapper stays `dir="ltr"` so Recharts'
 * own internal positioning is not flipped underneath that.
 *
 * ── The tutor's words are never touched ────────────────────────────────────
 * Session notes render through `<UserText>`: verbatim, never translated, with
 * direction decided by the browser from the content itself (decision 13,
 * FR-27.5). A note written in Roman Urdu stays in Roman Urdu in both views.
 */

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Warning } from '../../components/ui/Icon';
import { UserText } from '../../components/ui/UserText';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useReducedMotion } from '../../lib/motion';
import { useLocalName, useTopics } from '../../lib/reference';

/**
 * One hue per topic, from the design tokens rather than a rainbow.
 *
 * Five, reused beyond that: a chart needing a sixth distinguishable colour is a
 * chart nobody can read, and every series is named in text below the charts
 * anyway — the colour is a convenience, never the only carrier of meaning.
 */
const SERIES = ['#0F7B8A', '#1B3A57', '#8A6A2F', '#2C5478', '#0A5D69'];
const TRACK = '#E7ECF1';

/**
 * The two axis props that actually turn a chart around, from the page direction.
 *
 * Exported and pure so the rule can be tested as a rule. The alternative is
 * asserting on Recharts' rendered SVG, which in jsdom has no layout and
 * therefore no geometry to assert against — a test that would pass whether or
 * not the chart had been flipped, which is worse than no test.
 *
 * `reversed` turns the value axis so the earliest session sits where an Urdu
 * reader's eye starts; `orientation` moves the category axis to the same side.
 * Setting one without the other produces a chart that is half turned around,
 * which is the specific bug this exists to prevent.
 */
export function chartAxes(dir) {
  const rtl = dir === 'rtl';
  return { reversed: rtl, orientation: rtl ? 'right' : 'left' };
}

export default function Progress() {
  const { studentProfileId } = useParams();
  const { t, i18n } = useTranslation(['progress', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();

  const axes = chartAxes(i18n.dir());
  /*
   * Recharts draws its series on its own timer, which the `!important`
   * reduced-motion block in `index.css` cannot reach — a stylesheet cannot
   * stop JavaScript writing intermediate values into the DOM. So the chart
   * asks the preference directly.
   */
  const reduced = useReducedMotion();

  const ledger = useQuery({
    queryKey: ['progress', studentProfileId],
    queryFn: async () => (await api.get(`/students/${studentProfileId}/progress`))?.ledger ?? null,
    enabled: Boolean(studentProfileId),
  });

  const topics = useTopics({});
  const data = ledger.data ?? null;

  const topicName = (topicId) => {
    const row = (topics.data ?? []).find((tp) => tp.id === topicId);
    return row ? localName(row).text : topicId;
  };

  if (ledger.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (ledger.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={ledger.error} onRetry={ledger.refetch} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <EmptyState title={t('chart.noData')} description={t('chart.noDataBody')} />
      </div>
    );
  }

  const series = data.topics ?? [];
  const stagnant = new Set(data.stagnantTopicIds ?? []);

  /*
   * Sessions are the X axis rather than dates. Sessions are irregularly spaced,
   * and a date axis renders a fortnight's gap as a long flat line that reads as
   * "no progress" when it means "no session" — the one misreading this page
   * cannot afford, since it exists to answer exactly that question.
   */
  const maxPoints = Math.max(0, ...series.map((s) => s.points.length));
  const lineRows = Array.from({ length: maxPoints }, (_, index) => {
    const row = { session: index + 1 };
    for (const topic of series) {
      const point = topic.points[index];
      if (point) row[topic.topicId] = point.rating;
    }
    return row;
  });

  const barRows = series.map((topic) => ({
    name: topicName(topic.topicId),
    first: topic.firstRating,
    latest: topic.latestRating,
  }));

  const tiles = [
    { label: t('summary.sessions'), value: data.summary?.sessionsRecorded ?? 0 },
    { label: t('summary.topics'), value: data.summary?.topicsTaught ?? 0 },
    ...(data.summary?.hasDiagnostic
      ? [
          {
            label: t('summary.gapsAddressed'),
            value: data.summary?.gapsAddressed ?? 0,
            hint: t('summary.ofDiagnosed', { count: data.summary?.gapsDiagnosed ?? 0 }),
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('title')}</h1>
        <p className="mt-0.5 text-body text-ink">{t('forStudent', { name: data.studentName })}</p>
        <p className="mt-1 text-small text-slate">{t('intro')}</p>
      </header>

      {/* --- The answer to "is it working", before any scrolling ---------- */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-card border border-slate-line bg-white px-3 py-2.5"
          >
            <dt className="text-caption text-slate">{tile.label}</dt>
            <dd className="mt-0.5 font-mono text-title tnum text-ink">{tile.value}</dd>
            {tile.hint ? <p className="text-caption text-slate">{tile.hint}</p> : null}
          </div>
        ))}
      </dl>

      {series.length === 0 ? (
        <EmptyState title={t('chart.noData')} description={t('chart.noDataBody')} />
      ) : (
        <>
          {/* --- Mastery over time — FR-12.2 ------------------------------ */}
          <Card>
            <CardBody className="space-y-2">
              <h2 className="font-display text-subtitle text-ink">{t('chart.overTimeTitle')}</h2>
              <p className="text-caption text-slate">{t('chart.overTimeBody')}</p>

              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={lineRows} margin={{ top: 8, right: 8, bottom: 16, left: 0 }}>
                    <CartesianGrid stroke={TRACK} vertical={false} />
                    <XAxis
                      dataKey="session"
                      reversed={axes.reversed}
                      tick={{ fontSize: 12 }}
                      label={{
                        value: t('chart.axisSession'),
                        position: 'insideBottom',
                        offset: -8,
                        fontSize: 12,
                      }}
                    />
                    <YAxis
                      domain={[0, 5]}
                      ticks={[1, 2, 3, 4, 5]}
                      orientation={axes.orientation}
                      tick={{ fontSize: 12 }}
                      width={28}
                    />
                    <Tooltip
                      formatter={(value, key) => [value, topicName(key)]}
                      labelFormatter={(value) => `${t('chart.axisSession')} ${value}`}
                    />
                    <Legend formatter={(key) => topicName(key)} wrapperStyle={{ fontSize: 12 }} />
                    {series.map((topic, index) => (
                      <Line
                        key={topic.topicId}
                        type="monotone"
                        dataKey={topic.topicId}
                        stroke={SERIES[index % SERIES.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                        isAnimationActive={!reduced}
                        animationDuration={420}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          {/* --- Where each topic stands now ------------------------------ */}
          <Card>
            <CardBody className="space-y-2">
              <h2 className="font-display text-subtitle text-ink">{t('chart.byTopicTitle')}</h2>
              <p className="text-caption text-slate">{t('chart.byTopicBody')}</p>

              <div className="h-64 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={barRows}
                    layout="vertical"
                    margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid stroke={TRACK} horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 5]}
                      ticks={[0, 1, 2, 3, 4, 5]}
                      reversed={axes.reversed}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={96}
                      orientation={axes.orientation}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Legend
                      formatter={(key) => (key === 'first' ? t('chart.first') : t('chart.latest'))}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="first" fill={TRACK} isAnimationActive={!reduced} animationDuration={420} />
                    <Bar dataKey="latest" fill={SERIES[0]} isAnimationActive={!reduced} animationDuration={420} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          {/*
            --- The same figures, as a table ------------------------------

            An SVG is unreadable to a screen reader and unreadable to anyone
            whose connection dropped the chart. The numbers are the evidence;
            the chart is one way of looking at them, so the other way is here
            rather than nowhere. Visually hidden, and the same source data.
          */}
          <table className="sr-only">
            <caption>{t('chart.byTopicTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('topics.heading')}</th>
                <th scope="col">{t('chart.first')}</th>
                <th scope="col">{t('chart.latest')}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((topic) => (
                <tr key={topic.topicId}>
                  <th scope="row">{topicName(topic.topicId)}</th>
                  <td>{topic.firstRating}</td>
                  <td>{topic.latestRating}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* --- Topic by topic, in words — FR-12.4 ----------------------- */}
          <section className="space-y-2">
            <h2 className="font-display text-subtitle text-ink">{t('topics.heading')}</h2>
            {series.map((topic) => (
              <Card key={topic.topicId}>
                <CardBody className="space-y-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-small font-medium text-ink">{topicName(topic.topicId)}</h3>
                    <span className="font-mono text-small tnum text-ink">
                      {topic.latestRating} / 5
                    </span>
                  </div>
                  <p className="text-caption text-slate">
                    {t('topics.sessions', { count: topic.sessions })} ·{' '}
                    {topic.change > 0
                      ? t('topics.improved', { change: topic.change })
                      : topic.change < 0
                        ? t('topics.declined', { change: Math.abs(topic.change) })
                        : t('topics.unchanged')}
                  </p>

                  {stagnant.has(topic.topicId) ? (
                    <div className="flex gap-2 rounded-control border border-seal/35 bg-seal-soft px-3 py-2">
                      <Warning
                        size="sm"
                        className="mt-0.5 shrink-0 text-seal-deep"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-caption font-medium text-ink">{t('topics.stagnant')}</p>
                        <p className="text-caption text-slate">{t('topics.stagnantBody')}</p>
                      </div>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            ))}
          </section>
        </>
      )}

      {/* --- The diagnosed gaps against coverage — FR-12.3 ---------------- */}
      <section className="space-y-2">
        <h2 className="font-display text-subtitle text-ink">{t('gaps.heading')}</h2>
        {data.summary?.hasDiagnostic ? (
          <Card>
            <CardBody className="space-y-2">
              <p className="text-caption text-slate">{t('gaps.body')}</p>
              <ul className="space-y-1">
                {(data.gapCoverage ?? []).map((gap) => (
                  <li key={gap.topicId} className="flex flex-wrap items-center gap-2 text-small">
                    <span className="text-ink">{topicName(gap.topicId)}</span>
                    <Badge tone={gap.addressed ? 'settled' : 'neutral'}>
                      {gap.addressed ? t('gaps.addressed') : t('gaps.notAddressed')}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : (
          <p className="text-small text-slate">{t('gaps.none')}</p>
        )}
      </section>

      {/* --- The notes themselves ----------------------------------------- */}
      <section className="space-y-2">
        <h2 className="font-display text-subtitle text-ink">{t('sessions.heading')}</h2>
        <p className="text-caption text-slate">{t('sessions.body')}</p>

        {(data.entries ?? []).map((entry) => (
          <Card key={entry.bookingId}>
            <CardBody className="space-y-2">
              <p className="text-caption text-slate">
                {t('sessions.on', { date: fmt.date(entry.createdAt) })}
              </p>

              {entry.topicsCovered?.length > 0 ? (
                <ul className="space-y-0.5 text-small text-ink">
                  {entry.topicsCovered.map((topicId) => (
                    <li key={topicId}>
                      {t('sessions.ratingFor', {
                        topic: topicName(topicId),
                        rating: entry.masteryRatings?.[topicId] ?? '—',
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}

              {entry.note ? (
                <UserText className="text-small text-ink">{entry.note}</UserText>
              ) : (
                <p className="text-caption text-slate">{t('sessions.noNote')}</p>
              )}

              {/* Whose record this is — artefacts, never a tick (SEC-6). */}
              {entry.tutorVerification?.artefactsChecked?.length > 0 ? (
                <p className="text-caption text-slate">
                  {t('sessions.verifiedTutor', {
                    artefacts: entry.tutorVerification.artefactsChecked.join(' + '),
                  })}
                  {entry.tutorVerification.verifiedOn
                    ? ` ${t('sessions.verifiedOn', { date: fmt.date(entry.tutorVerification.verifiedOn) })}`
                    : ''}
                </p>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </section>

      <p className="text-caption text-slate">{t('privacy')}</p>
    </div>
  );
}
