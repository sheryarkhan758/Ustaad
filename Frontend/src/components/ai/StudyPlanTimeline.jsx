/**
 * The study plan — §6.26, FR-26.2, FR-26.4.
 *
 * ── Prerequisite order is the whole product ───────────────────────────────
 * A plan that teaches quadratics in week one to a student who cannot factorise
 * is worse than no plan: it spends the weeks before an exam on the thing that
 * will not stick. The ordering is therefore not a presentation choice — it is
 * the output — and the timeline renders steps in the sequence the server
 * produced, never re-sorted here.
 *
 * ── "Validated" is a claim, so the interface shows the evidence ───────────
 * `prereqValidated` says the ordering was checked **in code against the
 * prerequisite graph after generation**, and regenerated where it violated it
 * (FR-26.2). A plan that merely came out of a model and a plan that survived
 * that check look identical on a page; the badge distinguishes them, and where
 * the flag is false the interface says so rather than implying a check that
 * did not happen.
 *
 * Below each step the actual prerequisites are drawn from reference data, so a
 * parent can see *why* week two follows week one rather than being told it
 * does.
 *
 * ── The model emitted no dates ────────────────────────────────────────────
 * FR-26.4: the model returns `weekOffset` ordinals and application code turns
 * them into weeks between the start and the exam. Every date on this timeline
 * is arithmetic, which is why they can be trusted to add up.
 */

import { useTranslation } from 'react-i18next';

import { PrerequisiteBrowser } from '../pickers/PrerequisiteBrowser';
import { Badge, Card, CardBody } from '../ui/Card';
import { Check, Warning } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { useFormat } from '../../lib/format';
import { useLocalName, usePrerequisites } from '../../lib/reference';

function Step({ step, index, name, isNext }) {
  const { t } = useTranslation('ai');
  const fmt = useFormat();

  return (
    <li className="relative ps-8">
      {/*
        The spine and its node. `start-3` rather than `left-3` — the timeline
        runs from the reading edge and flips wholesale in Urdu.
      */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 start-3 top-0 w-px bg-slate-line"
      />
      <span
        aria-hidden="true"
        className={[
          'absolute start-[0.3125rem] top-1.5 h-3 w-3 rounded-full border-2 border-white',
          isNext ? 'bg-verdigris-deep' : 'bg-slate-line',
        ].join(' ')}
      />

      <div className="pb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-caption font-semibold uppercase tracking-wide text-slate">
            {t('plan.weekLabel', { number: (step.weekOffset ?? index) + 1 })}
          </span>
          {step.startDate ? (
            <span className="font-mono text-caption tnum text-slate">
              {fmt.date(`${step.startDate}T00:00:00.000Z`)}
            </span>
          ) : null}
          {isNext ? <Badge tone="verdigris">{t('plan.next')}</Badge> : null}
        </div>

        <h3 className="mt-0.5 text-small font-medium text-ink" lang={name?.lang}>
          {name?.text ?? step.topicId}
        </h3>

        {/* The model's focus note for the week — its words, unchanged. */}
        {step.focus ? (
          <UserText className="mt-0.5 text-caption text-slate">{step.focus}</UserText>
        ) : null}
      </div>
    </li>
  );
}

/**
 * @param {object} plan `{ steps[], summary, prereqValidated, targetDate }`
 * @param {string} [nextTopicId] The step to mark as current — decided by the
 *   caller from progress, not guessed here.
 */
export function StudyPlanTimeline({ plan, nextTopicId = null }) {
  const { t } = useTranslation('ai');
  const localName = useLocalName();

  const steps = plan?.steps ?? [];
  const graph = usePrerequisites(steps.map((step) => step.topicId));

  const nameFor = (topicId) => {
    const row = (graph.data?.topics ?? []).find((topic) => topic.id === topicId);
    return row ? localName(row) : null;
  };

  if (steps.length === 0) return null;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-subtitle text-ink">{t('plan.title')}</h2>

            {/*
              The distinction between a plan that was checked and one that
              merely looks ordered. Both states say what they mean.
            */}
            {plan.prereqValidated ? (
              <Badge tone="settled">
                <Check size="sm" aria-hidden="true" />
                {t('plan.validated')}
              </Badge>
            ) : (
              <Badge tone="warning">
                <Warning size="sm" aria-hidden="true" />
                {t('plan.notValidated')}
              </Badge>
            )}
          </div>

          <p className="mt-1 text-caption text-slate">
            {plan.prereqValidated ? t('plan.validatedNote') : t('plan.notValidatedNote')}
          </p>
        </div>

        {plan.summary ? <UserText className="text-small text-ink">{plan.summary}</UserText> : null}

        <ol className="mt-2">
          {steps.map((step, index) => (
            <Step
              key={`${step.topicId}-${index}`}
              step={step}
              index={index}
              name={nameFor(step.topicId)}
              isNext={nextTopicId ? step.topicId === nextTopicId : index === 0}
            />
          ))}
        </ol>

        {/* Why the order is what it is, from the graph rather than the model. */}
        <div>
          <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
            {t('plan.orderingHeading')}
          </h3>
          <p className="mb-2 mt-0.5 text-caption text-slate">{t('plan.orderingNote')}</p>
          <PrerequisiteBrowser topicIds={steps.map((step) => step.topicId)} />
        </div>

        <p className="text-caption text-slate">{t('plan.datesInCode')}</p>
      </CardBody>
    </Card>
  );
}
