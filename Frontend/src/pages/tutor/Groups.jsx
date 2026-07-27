/**
 * Group proposals, tutor side — §6.23, FR-23.5.
 *
 * ── As a unit, and why that is not a limitation ────────────────────────────
 * FR-23.5 says accept or decline the group as a unit, and the arithmetic is the
 * reason: the per-head rate is a function of the size. A tutor who could keep
 * two of three families would be agreeing to a price that was calculated for a
 * group that no longer exists, and the two remaining families would be paying
 * a three-way rate for two-way teaching. So there is no partial control here,
 * and the page says why rather than leaving her to wonder.
 *
 * ── What she is shown ──────────────────────────────────────────────────────
 * The per-head rate and the total, because the total is the number that decides
 * whether the hour is worth teaching, and it is the one a per-head figure hides.
 * Both come from `perHeadRate` on the proposal — computed from her own group
 * price by `resolveGroupRate` (FR-23.3). Nothing here is derived in the browser.
 *
 * Declining needs no reason (the same courtesy the booking flow extends), and
 * the page says so, because a decline somebody feels they must justify is a
 * decline they may not make.
 */

import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { GroupingReasons } from '../../components/groups/GroupingReasons';
import { PaymentBoundaryNotice } from '../../components/payments/PaymentBoundaryNotice';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useAreas, useLocalName } from '../../lib/reference';

function ProposalCard({ proposal, onRespond, pending }) {
  const { t } = useTranslation(['groups', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();
  const areas = useAreas(null);

  const detail = useQuery({
    queryKey: ['groups', 'proposal', proposal.id],
    queryFn: async () => api.get(`/groups/proposals/${proposal.id}`),
  });

  const members = detail.data?.members ?? [];
  const perHead = detail.data?.perHeadRate ?? proposal.perHeadRate ?? 0;
  const total = perHead * members.length;

  const areaName = (areaId) => {
    const row = (areas.data ?? []).find((a) => a.id === areaId);
    return row ? localName(row).text : areaId;
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-subtitle text-ink">
            {t('tutor.size', { count: members.length || proposal.memberCount || 0 })}
          </h2>
          <Badge tone="neutral">{proposal.status ?? 'proposed'}</Badge>
        </div>

        {/* The two figures that decide it. */}
        <div className="space-y-0.5">
          <p className="font-mono text-body tnum text-ink">
            {t('tutor.perHeadEarn', { amount: fmt.paisa(perHead) })}
          </p>
          <p className="font-mono text-small tnum text-slate">
            {t('tutor.totalEarn', { amount: fmt.paisa(total) })}
          </p>
        </div>

        {members.length > 0 ? (
          <div>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {t('proposal.membersHeading')}
            </h3>
            <ul className="mt-1 space-y-0.5 text-small text-ink">
              {members.map((member) => (
                <li key={member.groupRequestId}>
                  {t('pooling.memberLine', {
                    name: member.firstName,
                    area: areaName(member.areaId),
                  })}
                  {member.confirmed ? ` · ${t('proposal.confirmed')}` : ''}
                  {member.declined ? ` · ${t('proposal.declined')}` : ''}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-caption text-slate">{t('pooling.identityNote')}</p>
          </div>
        ) : null}

        {members[0] ? (
          <div className="border-t border-slate-line pt-3">
            <GroupingReasons
              reasonCodes={members[0].reasonCodes ?? []}
              fallback={members[0].explanation ?? []}
            />
          </div>
        ) : null}

        <PaymentBoundaryNotice />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="accent"
            busy={pending === `${proposal.id}:accept`}
            onClick={() => onRespond(proposal.id, 'accept')}
          >
            {t('tutor.accept')}
          </Button>
          <Button
            variant="ghost"
            busy={pending === `${proposal.id}:decline`}
            onClick={() => onRespond(proposal.id, 'decline')}
          >
            {t('tutor.decline')}
          </Button>
        </div>
        <p className="text-caption text-slate">{t('tutor.declineHint')}</p>
      </CardBody>
    </Card>
  );
}

export default function TutorGroups() {
  const { t } = useTranslation(['groups', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();

  const proposals = useQuery({
    queryKey: ['groups', 'proposals', 'tutor'],
    queryFn: async () => (await api.get('/groups/proposals'))?.proposals ?? [],
  });

  const respond = useMutation({
    mutationFn: ({ id, decision }) =>
      api.post(`/groups/proposals/${id}/tutor-response`, { decision }),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('tutor.responded') });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  if (proposals.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (proposals.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-8">
        <ErrorState error={proposals.error} onRetry={proposals.refetch} />
      </div>
    );
  }

  const items = proposals.data ?? [];

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('tutor.title')}</h1>
        <p className="mt-1 text-body text-slate">{t('tutor.intro')}</p>
      </header>

      {items.length === 0 ? (
        <EmptyState title={t('tutor.empty')} description={t('tutor.emptyBody')} />
      ) : (
        items.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onRespond={(id, decision) => respond.mutate({ id, decision })}
            pending={
              respond.isPending
                ? `${respond.variables?.id}:${respond.variables?.decision}`
                : null
            }
          />
        ))
      )}
    </div>
  );
}
