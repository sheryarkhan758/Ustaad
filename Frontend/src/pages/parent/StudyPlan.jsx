/**
 * The study plan and the exam countdown — §6.25, §6.26.
 *
 * Two views of one plan on one route. The countdown is what a family opens in
 * the weeks before an exam and the timeline is what they consult when deciding
 * what to do about it; splitting them across two pages would mean navigating
 * between "how long have I got" and "what is next", which are the same
 * question asked twice.
 *
 * **Which steps are done comes from the progress ledger**, not from a
 * checkbox. Mastery is recorded by the tutor in session notes (FR-12.1), so
 * the countdown reflects work that actually happened rather than a family
 * ticking off intentions.
 */

import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { ExamCountdown } from '../../components/ai/ExamCountdown';
import { ManualSearchLink } from '../../components/ai/AiFallback';
import { StudyPlanTimeline } from '../../components/ai/StudyPlanTimeline';
import { EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { api } from '../../lib/api';

/** A topic counts as covered once the ledger shows a mastery rating of 4+. */
const MASTERED_AT = 4;

export default function StudyPlan() {
  const { studentProfileId } = useParams();
  const { t } = useTranslation(['ai', 'common']);

  const plans = useQuery({
    queryKey: ['study-plans', studentProfileId],
    queryFn: async () =>
      (await api.get(`/ai/study-plans?studentProfileId=${studentProfileId}`))?.items ?? [],
    enabled: Boolean(studentProfileId),
  });

  const progress = useQuery({
    queryKey: ['progress', studentProfileId],
    queryFn: async () => (await api.get(`/students/${studentProfileId}/progress`))?.ledger ?? null,
    enabled: Boolean(studentProfileId),
  });

  if (plans.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (plans.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={plans.error} onRetry={plans.refetch} />
      </div>
    );
  }

  // Newest first from the server. A family with two plans wants the current one.
  const plan = (plans.data ?? [])[0] ?? null;

  if (!plan) {
    return (
      <div className="mx-auto max-w-prose space-y-4 px-4 py-6">
        <EmptyState title={t('plan.emptyTitle')} description={t('plan.emptyBody')} />
        <ManualSearchLink />
      </div>
    );
  }

  /*
   * Mastered topics, from the tutor's own session notes. `?? []` rather than a
   * blocking wait: a plan with an unknown progress state still shows its
   * timeline and its countdown, starting from the first step — which is the
   * right answer for a plan nobody has started.
   */
  const mastered = (progress.data?.topics ?? [])
    .filter((topic) => (topic.latestMastery ?? 0) >= MASTERED_AT)
    .map((topic) => topic.topicId);

  const next = plan.steps?.find((step) => !mastered.includes(step.topicId)) ?? null;

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <h1 className="font-display text-display text-ink">{t('plan.pageTitle')}</h1>

      <ExamCountdown
        plan={{ ...plan, studentProfileId }}
        masteredTopicIds={mastered}
      />

      <StudyPlanTimeline plan={plan} nextTopicId={next?.topicId ?? null} />
    </div>
  );
}
