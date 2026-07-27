/**
 * The empty state that does real work — §6.24, FR-24.1.
 *
 * ── When this fires, and why it matters ────────────────────────────────────
 * A female-only home-tuition search in a thin area returns nothing. That is not
 * an edge case — it is the platform's hardest and most important case, the
 * exact family §2.1 was written about, and the moment they are most likely to
 * conclude the product is useless and leave.
 *
 * A shrug here loses them. So this screen offers the two things that can
 * actually change the outcome:
 *
 *  1. **Widen to neighbouring areas.** Often there *is* a tutor, one area over,
 *     and the family would happily take her. The adjacency list is curated, so
 *     this is a real suggestion rather than a radius guess. Offered first
 *     because it can succeed immediately.
 *
 *  2. **Post to the unmet demand board.** Tutors read it (FR-24.3) and it is
 *     what tells the platform where supply is missing. The family gets nothing
 *     today, but the record is the only mechanism by which they get something
 *     later.
 *
 * ── What is deliberately *not* offered ─────────────────────────────────────
 * **Never "remove the gender filter".** For the family this state is designed
 * around, that suggestion is not a compromise — it is a suggestion to stop
 * using the platform. Offering it would say the constraint was a preference all
 * along, which is precisely what §6.16 exists to deny.
 *
 * Relaxing subject, level or budget is fine to suggest and is not.
 * Relaxing *that* one is not.
 *
 * ── The demand record carries no identity ──────────────────────────────────
 * `POST /api/ai/intake` and the demand board store the shape of the request and
 * nothing about who made it (SEC-16). The copy says so, because a parent asked
 * to "tell us what you need" reasonably wants to know what is being kept.
 */

import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { Check, Search, Warning } from '../ui/Icon';
import { api } from '../../lib/api';
import { useAdjacentAreas, useAreas, useLocalName } from '../../lib/reference';

export function NoResults({ query, onWiden }) {
  const { t } = useTranslation(['search', 'common']);
  const localName = useLocalName();

  const adjacent = useAdjacentAreas(query.areaId ? [query.areaId] : []);
  // The adjacency endpoint returns ids. Resolving them to names matters: a
  // parent offered "karachi-dha" has been shown a database key, not a place.
  const areas = useAreas(query.cityId);
  const areaById = new Map((areas.data ?? []).map((area) => [area.id, area]));
  const canWiden = Boolean(query.areaId) && !query.includeAdjacentAreas;
  const adjacentCount = adjacent.data?.length ?? 0;

  /*
   * `POST /api/demand` — FR-24.1's other half.
   *
   * This button previously posted to `/ai/intake/unmet-demand`, which does not
   * exist and never did: only the diagnostic agent could record demand, so a
   * family who searched manually and found nothing had the most useful signal
   * on the platform and no way to send it. The route now exists and takes no
   * field identifying the caller (FR-24.2).
   *
   * `reason` is not sent. The server sets `no_matches` itself, because this
   * button is only reachable from a search that returned nothing — a caller
   * choosing its own reason could mislabel the board.
   */
  const postDemand = useMutation({
    mutationFn: () =>
      api.post('/demand', {
        subjectId: query.subjectId,
        levelId: query.levelId ?? null,
        boardId: query.boardId ?? null,
        topicIds: query.topicIds ?? [],
        areaId: query.areaId ?? null,
        genderPreference: query.genderPreference ?? 'no_preference',
        budgetMaxPaisa: query.maxHourlyRate ?? null,
      }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-2 text-center">
          <Search className="mx-auto text-slate-light" size="lg" />
          <h2 className="font-display text-title text-ink">{t('empty.title')}</h2>
          <p className="mx-auto max-w-prose text-small text-slate">
            {query.genderPreference === 'female_only'
              ? t('empty.bodyFemaleOnly')
              : t('empty.body')}
          </p>
        </CardBody>
      </Card>

      {/* --- Recovery 1: widen to neighbouring areas ------------------- */}
      {canWiden ? (
        <Card className="border-verdigris/30">
          <CardBody className="space-y-3">
            <h3 className="font-display text-subtitle text-ink">{t('empty.widenTitle')}</h3>
            <p className="text-small text-slate">
              {adjacentCount > 0
                ? t('empty.widenBody', { count: adjacentCount })
                : t('empty.widenNoneBody')}
            </p>

            {adjacentCount > 0 ? (
              <>
                <ul className="flex flex-wrap gap-1.5">
                  {(adjacent.data ?? []).map((areaId) => {
                    const area = areaById.get(areaId);
                    const shown = area ? localName(area) : { text: areaId, lang: undefined };
                    return (
                      <li
                        key={areaId}
                        className="rounded-full border border-slate-line bg-paper px-2.5 py-1 text-caption text-ink"
                      >
                        <span lang={shown.lang}>{shown.text}</span>
                      </li>
                    );
                  })}
                </ul>
                <Button variant="accent" onClick={onWiden}>
                  {t('empty.widenAction')}
                </Button>
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {/* --- Recovery 2: the unmet demand board ------------------------ */}
      <Card>
        <CardBody className="space-y-3">
          <h3 className="font-display text-subtitle text-ink">{t('empty.demandTitle')}</h3>
          <p className="text-small text-slate">{t('empty.demandBody')}</p>

          {/* SEC-16, stated where it is relevant. */}
          <p className="rounded-control border border-slate-line bg-paper px-3 py-2 text-caption text-slate">
            {t('empty.demandPrivacy')}
          </p>

          {postDemand.isSuccess ? (
            <p className="flex items-center gap-2 text-small font-medium text-settled">
              <Check size="sm" />
              {t('empty.demandPosted')}
            </p>
          ) : (
            <Button
              variant="secondary"
              busy={postDemand.isPending}
              onClick={() => postDemand.mutate()}
            >
              {t('empty.demandAction')}
            </Button>
          )}

          {postDemand.isError ? (
            <p className="flex items-start gap-2 text-caption text-flag">
              <Warning size="sm" />
              {postDemand.error?.message}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/*
        Other filters worth relaxing — and note what is absent. The gender
        preference is never suggested as a thing to give up.
      */}
      <Card>
        <CardBody>
          <h3 className="font-display text-subtitle text-ink">{t('empty.otherTitle')}</h3>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-small text-slate">
            {query.maxHourlyRate ? <li>{t('empty.otherBudget')}</li> : null}
            {query.topicIds?.length ? <li>{t('empty.otherTopics')}</li> : null}
            {query.mode ? <li>{t('empty.otherMode')}</li> : null}
            {query.verifiedOnly ? <li>{t('empty.otherVerified')}</li> : null}
            {query.availableWeekday !== undefined ? <li>{t('empty.otherAvailability')}</li> : null}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
