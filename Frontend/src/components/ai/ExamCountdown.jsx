/**
 * Examination countdown — §6.25.
 *
 * ── One number, one topic, nothing else ───────────────────────────────────
 * This is opened by a student three weeks before a board exam. The useful
 * answers are "how long have I got" and "what do I do next"; everything else
 * on a dashboard is a reason to keep scrolling instead of studying. So the
 * view is a days figure, a progress line, and the single next topic — and the
 * rest of the plan is one link away rather than laid out underneath.
 *
 * ── The arithmetic is here, and that is allowed ───────────────────────────
 * Days remaining is a subtraction over two stored dates, and progress is a
 * count over a stored plan against a stored ledger. §2.8 puts the computing of
 * *statistics* — medians, rates, aggregates over other people — in a job.
 * Counting the steps of one plan for the person looking at it is arrangement,
 * not a statistic, and materialising it would mean a nightly job to tell one
 * student what she can see from the page she is on.
 *
 * ── When the exam has passed ──────────────────────────────────────────────
 * A negative countdown is worse than none: it turns a study aid into a
 * reproach. Past the date the view says the exam has passed and stops
 * counting.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge, Card, CardBody } from '../ui/Card';
import { Clock } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { useFormat } from '../../lib/format';
import { useLocalName, usePrerequisites } from '../../lib/reference';

/** Whole days between today and an ISO date, in UTC to avoid a DST off-by-one. */
export function daysUntil(targetDate, today = new Date()) {
  const target = Date.parse(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(target)) return null;

  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - midnight) / 86_400_000);
}

/**
 * The first step the student has not yet mastered.
 *
 * Mastery comes from the progress ledger — session notes a tutor wrote, not a
 * self-assessment. Falling back to the first step when nothing is mastered is
 * correct: a plan not started begins at the beginning.
 */
export function nextStep(steps, masteredTopicIds = []) {
  const mastered = new Set(masteredTopicIds);
  return steps.find((step) => !mastered.has(step.topicId)) ?? null;
}

export function ExamCountdown({ plan, masteredTopicIds = [], studentName = null, today }) {
  const { t } = useTranslation('ai');
  const fmt = useFormat();
  const localName = useLocalName();

  // Memoised so the `??` fallback does not mint a new empty array on every
  // render and invalidate everything downstream of it.
  const steps = useMemo(() => plan?.steps ?? [], [plan?.steps]);
  const graph = usePrerequisites(steps.map((step) => step.topicId));

  const next = useMemo(() => nextStep(steps, masteredTopicIds), [steps, masteredTopicIds]);
  const done = steps.filter((step) => masteredTopicIds.includes(step.topicId)).length;
  const days = plan?.targetDate ? daysUntil(plan.targetDate, today) : null;

  const nextName = next
    ? (graph.data?.topics ?? []).find((topic) => topic.id === next.topicId)
    : null;
  const nextLabel = nextName ? localName(nextName) : null;

  if (!plan?.targetDate) return null;

  const passed = days !== null && days < 0;
  const percent = steps.length > 0 ? done / steps.length : 0;

  return (
    <Card>
      <CardBody className="space-y-5">
        {/* --- The number ------------------------------------------------- */}
        <div className="text-center">
          <p className="text-caption font-semibold uppercase tracking-wide text-slate">
            {studentName
              ? t('countdown.headingFor', { name: studentName })
              : t('countdown.heading')}
          </p>

          {passed ? (
            <p className="mt-2 text-title text-ink">{t('countdown.passed')}</p>
          ) : (
            <>
              <p className="mt-1 font-display text-display text-ink tnum" aria-hidden="true">
                {fmt.number(days)}
              </p>
              {/* The figure and its unit as one phrase for a screen reader,
                  rather than a bare number followed by a word. */}
              <p className="sr-only">{t('countdown.daysLeft', { count: days })}</p>
              <p className="text-small text-slate" aria-hidden="true">
                {t('countdown.daysUnit', { count: days })}
              </p>
            </>
          )}

          <p className="mt-1 font-mono text-caption tnum text-slate">
            {t('countdown.examOn', {
              date: fmt.date(`${plan.targetDate}T00:00:00.000Z`),
            })}
          </p>
        </div>

        {/* --- Progress ---------------------------------------------------- */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-small font-medium text-ink">{t('countdown.progressHeading')}</h2>
            <span className="font-mono text-small tnum text-slate">
              {t('countdown.progressCount', { done, total: steps.length })}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-label={t('countdown.progressHeading')}
            className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paper-sunk"
          >
            <div
              className="h-full rounded-full bg-verdigris"
              style={{ inlineSize: `${Math.round(percent * 100)}%` }}
            />
          </div>

          <p className="mt-1 text-caption text-slate">{t('countdown.progressNote')}</p>
        </div>

        {/* --- The one next thing ------------------------------------------ */}
        {next ? (
          <div className="rounded-control border border-verdigris/25 bg-verdigris-soft px-4 py-3">
            <div className="flex items-center gap-2">
              <Clock size="sm" className="text-verdigris-deep" aria-hidden="true" />
              <h2 className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
                {t('countdown.nextHeading')}
              </h2>
            </div>

            <p className="mt-1 text-body font-medium text-ink" lang={nextLabel?.lang}>
              {nextLabel?.text ?? next.topicId}
            </p>

            {next.focus ? (
              <UserText className="mt-0.5 text-small text-slate">{next.focus}</UserText>
            ) : null}
          </div>
        ) : (
          <div className="rounded-control border border-settled/30 bg-settled-soft px-4 py-3">
            <Badge tone="settled">{t('countdown.allDone')}</Badge>
            <p className="mt-1 text-small text-ink">{t('countdown.allDoneBody')}</p>
          </div>
        )}

        {/* The rest of the plan, one link away rather than laid out here. */}
        <Link
          to={`/my/plan/${plan.studentProfileId ?? ''}`}
          className="inline-flex min-h-tap items-center text-small font-medium text-verdigris-deep underline underline-offset-2"
        >
          {t('countdown.seeFullPlan')}
        </Link>
      </CardBody>
    </Card>
  );
}
