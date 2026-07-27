/**
 * Competency verification, per topic — §6.11, §6.28.
 *
 * Separate from `/tutor/verification`, which is the **identity** track:
 * documents, a CNIC, an administrator. FR-6.2 keeps the two apart and never
 * merges them into one badge, and two screens is the honest expression of
 * that — a tutor whose identity is verified and whose Thermodynamics claim
 * failed should see exactly that, not a single ambiguous status.
 *
 * A claim is assessed **per topic** (FR-11.6). Failing one leaves every other
 * claim untouched, and the list says so rather than leaving her to infer it
 * from an absence.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { CompetencyExam } from '../../components/ai/CompetencyExam';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useBoards, useLevels, useLocalName, useSubjects } from '../../lib/reference';

/** How a claim's status reads to the person who made it. */
const STATUS_TONE = {
  asserted: 'neutral',
  under_assessment: 'warning',
  verified: 'settled',
  failed: 'neutral',
  expired: 'warning',
  appealed: 'seal',
};

export default function Competency() {
  const { t } = useTranslation(['ai', 'tutor', 'common']);
  const fmt = useFormat();
  const queryClient = useQueryClient();
  const [sitting, setSitting] = useState(null);

  const claims = useQuery({
    queryKey: ['tutor', 'claims'],
    queryFn: async () => (await api.get('/tutors/claims'))?.claims ?? [],
  });

  /*
   * A claim carries ids, not names. Resolving them through the cached
   * reference hooks is what puts "Mathematics · Matric · Sindh Board" on the
   * card instead of three slugs — and gets the Urdu names for free where the
   * reference data has them.
   */
  const subjects = useSubjects();
  const levels = useLevels();
  const boards = useBoards();
  const localName = useLocalName();

  const nameOf = (rows, id) => {
    const row = (rows.data ?? []).find((item) => item.id === id);
    return row ? localName(row).text : id;
  };

  if (claims.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (claims.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-8">
        <ErrorState error={claims.error} onRetry={claims.refetch} />
      </div>
    );
  }

  const items = claims.data ?? [];

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('exam.pageTitle')}</h1>
        <p className="mt-1 text-body text-slate">{t('exam.pageBody')}</p>
        {/* FR-11.6, said once at the top. */}
        <p className="mt-1 text-caption text-slate">{t('exam.perTopicNote')}</p>
      </header>

      {sitting ? (
        <>
          <button
            type="button"
            onClick={() => setSitting(null)}
            className="min-h-tap text-small text-slate underline underline-offset-2"
          >
            {t('exam.backToClaims')}
          </button>
          <CompetencyExam
            claim={sitting}
            onFinished={() => {
              queryClient.invalidateQueries({ queryKey: ['tutor', 'claims'] });
            }}
          />
        </>
      ) : items.length === 0 ? (
        <EmptyState title={t('exam.emptyTitle')} description={t('exam.emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {items.map((claim) => (
            <li key={claim.id}>
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display text-subtitle text-ink">
                      {[
                        nameOf(subjects, claim.subjectId),
                        nameOf(levels, claim.levelId),
                        nameOf(boards, claim.boardId),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </h2>
                    <Badge tone={STATUS_TONE[claim.claimStatus] ?? 'neutral'}>
                      {t(`tutor:claims.status${claim.claimStatus
                        .split('_')
                        .map((part) => part[0].toUpperCase() + part.slice(1))
                        .join('')}`, { defaultValue: claim.claimStatus })}
                    </Badge>
                  </div>

                  {claim.verifiedAt ? (
                    <p className="font-mono text-caption tnum text-slate">
                      {t('exam.assessedOn', { date: fmt.date(claim.verifiedAt) })}
                      {claim.expiresOn
                        ? ` · ${t('exam.expiresOn', {
                            date: fmt.date(`${claim.expiresOn}T00:00:00.000Z`),
                          })}`
                        : ''}
                    </p>
                  ) : null}

                  {claim.claimStatus !== 'verified' ? (
                    <Button
                      variant="accent"
                      onClick={() =>
                        setSitting({
                          ...claim,
                          topicId: claim.topicIds?.[0] ?? claim.subjectId,
                          topicName: nameOf(subjects, claim.subjectId),
                        })
                      }
                    >
                      {claim.claimStatus === 'failed'
                        ? t('exam.appeal.action')
                        : t('exam.startAssessment')}
                    </Button>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
