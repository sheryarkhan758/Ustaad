/**
 * See it work — §6.15, FR-15.1, FR-15.7.
 *
 * Five scenarios, none requiring an account, **none making a live model
 * call**. Every one replays a stored session; the server returns
 * `liveModelCalls: 0` on each and the interface shows that figure rather than
 * claiming it in copy.
 *
 * This is the assessment-day path. It works with the AI keys removed from
 * `.env` entirely — which is the point, because a rate limit at the wrong
 * moment is a named risk in §15 and a demonstration that depends on a free
 * tier is a demonstration that can be taken away by somebody else's traffic.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { DemoReplay } from '../../components/ai/DemoReplay';
import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { api } from '../../lib/api';

export default function Demo() {
  const { t } = useTranslation(['ai', 'common']);
  const [openKey, setOpenKey] = useState(null);

  const scenarios = useQuery({
    queryKey: ['demo', 'scenarios'],
    queryFn: () => api.get('/demo/scenarios'),
    // Stored sessions never change, and on assessment day the fewer requests
    // in flight the better.
    staleTime: Infinity,
  });

  if (scenarios.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (scenarios.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={scenarios.error} onRetry={scenarios.refetch} />
      </div>
    );
  }

  const items = scenarios.data?.items ?? [];
  const replay = scenarios.data?.replay ?? {};

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-display text-ink">{t('demo.title')}</h1>
        <p className="mt-1 text-body text-slate">{t('demo.body')}</p>

        {/* The server's own sentence about its own behaviour, not ours. */}
        <p className="mt-2 rounded-control border border-seal/35 bg-seal-soft px-3 py-2 text-small text-ink">
          {replay.note ?? t('replay.body')}
        </p>
      </header>

      {openKey ? (
        <>
          <button
            type="button"
            onClick={() => setOpenKey(null)}
            className="min-h-tap text-small text-slate underline underline-offset-2"
          >
            {t('demo.backToList')}
          </button>
          <DemoReplay scenarioKey={openKey} />
        </>
      ) : (
        <ul className="space-y-3">
          {items.map((scenario) => (
            <li key={scenario.key}>
              <Card interactive>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display text-subtitle text-ink">{scenario.title}</h2>
                    <Badge tone="seal">{t('replay.badge')}</Badge>
                  </div>

                  <p className="text-small text-slate">{scenario.summary}</p>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenKey(scenario.key)}
                      className="inline-flex min-h-tap items-center rounded-control bg-ink px-4 text-small font-medium text-white hover:bg-ink-deep"
                    >
                      {t('demo.replay')}
                    </button>
                    <span className="font-mono text-caption text-slate">{scenario.requirement}</span>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
