/**
 * Group tuition, family side — §6.23.
 *
 * ── What this screen is actually for ───────────────────────────────────────
 * Twelve thousand rupees one-to-one becomes five thousand each across three
 * students, and neighbourhood study groups already form informally all the time.
 * What the informal version cannot do is tell a family *why* it was put with
 * these particular students, which is the question anyone asks before agreeing
 * to share their child's tuition.
 *
 * So the pooling state and the reasons are the page, and the price is a
 * consequence shown beside them. A screen that led with the saving would be
 * selling the arrangement; this one describes it.
 *
 * ── Never an algorithmic recommendation ────────────────────────────────────
 * Decision 10. There is no "match score", no "recommended for you", no ranking
 * of candidate groups. `poolRequests` is a solver: every condition either held
 * or the group does not exist. `GroupingReasons` states them as conditions, and
 * this page's copy stays in the same register — "what it matched with", not
 * "your best match".
 *
 * ── Identity is limited until it forms (FR-23.8) ───────────────────────────
 * First name and area, and the page says so where the names appear rather than
 * in a footnote. The server enforces it; saying it here is what stops a family
 * wondering whether more was shared about them than they were told.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { GroupingReasons } from '../../components/groups/GroupingReasons';
import { Badge, Card, CardBody, EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useAreas, useLocalName } from '../../lib/reference';

/* =========================================================================
 * One open request, and whatever it has pooled with
 * ====================================================================== */

function RequestCard({ request, onWithdraw, withdrawing }) {
  const { t } = useTranslation(['groups', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();
  const areas = useAreas(null);

  /*
   * The pooling preview. Fetched per request rather than in a list endpoint
   * because it is derived — the solver runs over whatever is open at this
   * moment, and a cached list would show a family a group that has since
   * dissolved.
   */
  const matches = useQuery({
    queryKey: ['groups', 'matches', request.id],
    queryFn: async () => api.get(`/groups/requests/${request.id}/matches`),
    enabled: request.status === 'open' || request.status === 'proposed',
  });

  const group = matches.data?.group ?? null;
  const members = matches.data?.members ?? [];
  const mine = group?.explanations?.find((e) => e.requestId === request.id) ?? null;

  const areaName = (areaId) => {
    const row = (areas.data ?? []).find((a) => a.id === areaId);
    return row ? localName(row).text : areaId;
  };

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-subtitle text-ink">{request.subjectId}</h2>
            <p className="mt-0.5 text-caption text-slate">
              {request.levelId} · {request.boardId} · {areaName(request.areaId)}
            </p>
          </div>
          <Badge tone={request.status === 'matched' ? 'settled' : 'neutral'}>
            {t(`family.status.${request.status}`, { defaultValue: request.status })}
          </Badge>
        </div>

        {request.expiresAt ? (
          <p className="text-caption text-slate">
            {t('family.expiresOn', { date: fmt.date(request.expiresAt) })} — {t('family.expiryNote')}
          </p>
        ) : null}

        {/* --- Pooling state ------------------------------------------------ */}
        <div className="border-t border-slate-line pt-3">
          <h3 className="font-display text-small font-medium text-ink">{t('pooling.heading')}</h3>

          {matches.isPending ? <SkeletonCard label={t('common:state.loading')} /> : null}

          {matches.isSuccess && !group ? (
            <div className="mt-1">
              <p className="text-small text-ink">{t('pooling.none')}</p>
              <p className="mt-1 text-caption text-slate">{t('pooling.noneBody')}</p>
            </div>
          ) : null}

          {group ? (
            <div className="mt-2 space-y-3">
              <p className="text-small text-ink">
                {t('pooling.sizeNow', { count: group.memberRequestIds?.length ?? 0 })}
              </p>

              <div>
                <h4 className="text-caption font-semibold uppercase tracking-wide text-slate">
                  {t('pooling.membersHeading')}
                </h4>
                <ul className="mt-1 space-y-0.5 text-small text-ink">
                  {members.map((member) => (
                    <li key={member.groupRequestId}>
                      {t('pooling.memberLine', {
                        name: member.firstName,
                        area: areaName(member.areaId),
                      })}
                    </li>
                  ))}
                </ul>
                {/* Said where the names are, not in a policy page. */}
                <p className="mt-1 text-caption text-slate">{t('pooling.identityNote')}</p>
              </div>

              {/* The whole point of a solver rather than a model. */}
              <GroupingReasons
                reasonCodes={mine?.reasonCodes ?? []}
                fallback={mine?.reasons ?? []}
              />
            </div>
          ) : null}
        </div>

        <div>
          <Button
            variant="ghost"
            onClick={() => onWithdraw(request.id)}
            busy={withdrawing === request.id}
          >
            {t('family.withdraw')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* =========================================================================
 * The page
 * ====================================================================== */

export default function ParentGroups() {
  const { t } = useTranslation(['groups', 'common']);
  const queryClient = useQueryClient();

  const requests = useQuery({
    queryKey: ['groups', 'requests'],
    queryFn: async () => (await api.get('/groups/requests'))?.requests ?? [],
  });

  const withdraw = useMutation({
    mutationFn: (id) => api.del(`/groups/requests/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['groups'] }),
  });

  if (requests.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (requests.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={requests.error} onRetry={requests.refetch} />
      </div>
    );
  }

  const items = requests.data ?? [];

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('family.title')}</h1>
        <p className="mt-1 text-body text-slate">{t('family.intro')}</p>
      </header>

      {items.length === 0 ? (
        <EmptyState title={t('family.empty')} description={t('family.emptyBody')} />
      ) : (
        <section className="space-y-4">
          <h2 className="font-display text-subtitle text-ink">{t('family.openTitle')}</h2>
          {items.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onWithdraw={(id) => withdraw.mutate(id)}
              withdrawing={withdraw.isPending ? withdraw.variables : null}
            />
          ))}
        </section>
      )}

      <p className="text-caption text-slate">
        <Link to="/my/bookings" className="underline underline-offset-2">
          {t('common:nav.myBookings')}
        </Link>
      </p>
    </div>
  );
}
