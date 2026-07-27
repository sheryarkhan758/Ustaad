/**
 * Recorded session replay — §6.15, FR-15.7, §15 risk row.
 *
 * ── This is the assessment-day safety net ─────────────────────────────────
 * The §15 risk register names it directly: a rate limit during a demonstration
 * breaks the demonstration. The AI path has a free tier, a daily budget and
 * two providers, and any of them can be exhausted at the wrong moment by
 * somebody else's traffic. So the demonstration does not use them.
 *
 * Every turn here comes from `/api/demo/scenarios/...`, which reads stored
 * sessions. **No provider is contacted on this path and no key is required** —
 * the endpoints work with the AI keys removed from `.env` entirely. The server
 * asserts this by returning `liveModelCalls: 0`, and this component displays
 * that figure rather than asserting it in copy, so the claim is the server's
 * and not the interface's.
 *
 * ── Labelled as recorded, unmistakably ────────────────────────────────────
 * FR-15.7. A replay that looks like a live conversation is a demonstration
 * that misrepresents itself, and an assessor who later discovers the
 * difference is entitled to distrust everything else on the page. The banner
 * is above the transcript, in normal-sized text, and says both what this is
 * and why it was built that way.
 *
 * ── Turn by turn, at the presenter's pace ─────────────────────────────────
 * The transcript advances on a click rather than a timer. A timed replay
 * either races ahead of somebody explaining it or stalls while they answer a
 * question. The turn index is a path parameter server-side, so two people
 * demonstrating at once cannot share a cursor.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { PrerequisiteBrowser } from '../pickers/PrerequisiteBrowser';
import { Button } from '../ui/Button';
import { Badge, Card, CardBody, ErrorState, SkeletonCard } from '../ui/Card';
import { UserText } from '../ui/UserText';
import { api } from '../../lib/api';

/**
 * The banner. Not dismissible, not subtle, above the content it describes.
 */
function RecordedBanner({ liveModelCalls }) {
  const { t } = useTranslation('ai');

  return (
    <div
      role="note"
      className="rounded-control border border-seal/35 bg-seal-soft px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="seal">{t('replay.badge')}</Badge>
        <span className="font-mono text-caption tnum text-seal-deep">
          {t('replay.liveCalls', { count: liveModelCalls ?? 0 })}
        </span>
      </div>
      <p className="mt-1.5 text-small text-ink">{t('replay.body')}</p>
      <p className="mt-1 text-caption text-slate">{t('replay.why')}</p>
    </div>
  );
}

export function DemoReplay({ scenarioKey }) {
  const { t } = useTranslation(['ai', 'common']);
  const [shown, setShown] = useState(1);

  const scenario = useQuery({
    queryKey: ['demo', 'scenario', scenarioKey],
    queryFn: () => api.get(`/demo/scenarios/${scenarioKey}`),
    enabled: Boolean(scenarioKey),
    // Stored sessions do not change. Refetching one is pure cost, and on
    // assessment day the fewer requests in flight the better.
    staleTime: Infinity,
  });

  if (scenario.isPending) return <SkeletonCard label={t('common:state.loading')} />;
  if (scenario.isError) {
    return <ErrorState error={scenario.error} onRetry={scenario.refetch} />;
  }

  const data = scenario.data?.scenario;
  if (!data) return null;

  const turns = data.turns ?? [];
  const visible = turns.slice(0, shown);
  const hasNext = shown < turns.length;
  const exhibit = data.exhibit ?? null;

  return (
    <div className="space-y-4">
      <RecordedBanner liveModelCalls={data.liveModelCalls} />

      <div>
        <h2 className="font-display text-subtitle text-ink">{data.title}</h2>
        <p className="mt-0.5 text-small text-slate">{data.summary}</p>
        <p className="mt-1 font-mono text-caption text-slate">
          {t('replay.provenance', {
            model: data.model ?? '—',
            version: data.promptVersion ?? '—',
          })}
        </p>
      </div>

      <Card>
        <CardBody>
          <ul aria-live="polite" aria-label={t('replay.transcriptLabel')} className="space-y-2">
            {visible.map((turn, index) => {
              const isPerson = turn.role === 'parent' || turn.role === 'tutor';
              return (
                <li
                  key={`${turn.role}-${index}`}
                  className={isPerson ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={[
                      'max-w-[85%] rounded-control px-3 py-2',
                      isPerson
                        ? 'bg-ink text-white'
                        : 'border border-slate-line bg-white text-ink',
                    ].join(' ')}
                  >
                    <p className="mb-0.5 text-caption uppercase tracking-wide opacity-70">
                      {t(`replay.role.${turn.role}`, { defaultValue: turn.role })}
                    </p>
                    {/* Stored text, replayed exactly as recorded. */}
                    <UserText className="text-small">{turn.text}</UserText>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {hasNext ? (
              <Button variant="accent" onClick={() => setShown((count) => count + 1)}>
                {t('replay.nextTurn')}
              </Button>
            ) : (
              <Badge tone="settled">{t('replay.finished')}</Badge>
            )}

            <span className="font-mono text-caption tnum text-slate">
              {t('replay.position', { shown: visible.length, total: turns.length })}
            </span>

            {shown > 1 ? (
              <button
                type="button"
                onClick={() => setShown(1)}
                className="min-h-tap text-small text-slate underline underline-offset-2"
              >
                {t('replay.restart')}
              </button>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* --- The exhibit: what this scenario is evidence of ---------------- */}
      {exhibit && !hasNext ? (
        <Card>
          <CardBody className="space-y-3">
            <h3 className="font-display text-subtitle text-ink">{t('replay.exhibitHeading')}</h3>

            {/*
              Authored seed content rather than something a user typed, but it
              is still stored text rendered verbatim — which is exactly what
              `UserText` is for, and wrapping it keeps the structural check
              strict instead of carving out an exemption.
            */}
            {exhibit.note ? (
              <UserText className="text-small text-ink">{exhibit.note}</UserText>
            ) : null}

            {/* The chain, drawn from reference data rather than from the
                recording — the same component the live gap map uses. */}
            {exhibit.prerequisiteChain?.length ? (
              <PrerequisiteBrowser topicIds={exhibit.prerequisiteChain} />
            ) : null}

            {Array.isArray(exhibit.outcome) ? (
              <ul className="space-y-1.5">
                {exhibit.outcome.map((row) => (
                  <li key={row.topic} className="flex flex-wrap items-center gap-2">
                    <span className="text-small text-ink">{row.topic}</span>
                    <Badge tone={row.verdict === 'passed' ? 'settled' : 'neutral'}>
                      {t(`replay.verdict.${row.verdict}`, { defaultValue: row.verdict })}
                    </Badge>
                    {/* A badge string only where one was actually issued —
                        a failed topic carries no badge, and showing an empty
                        one would imply a partial pass (§2.5). */}
                    {row.badge ? (
                      <span className="font-mono text-caption text-seal-deep">{row.badge}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
