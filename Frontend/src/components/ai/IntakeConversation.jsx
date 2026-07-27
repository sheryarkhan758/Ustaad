/**
 * The diagnostic conversation — §6.10, §7.
 *
 * ── Turn-by-turn, never a frozen screen ───────────────────────────────────
 * The server answers a whole turn at once, so there is nothing to stream. What
 * matters is that the wait is *visible and attributed*: the parent's message
 * appears immediately as their own, and a labelled "thinking" turn takes its
 * place in the transcript while the request is out. The page never blocks, the
 * scroll position never jumps, and the composer stays visible so somebody can
 * re-read what they wrote.
 *
 * A model call takes seconds. Seconds with no acknowledgement are how a person
 * decides a page is broken and reloads it — which, before session persistence,
 * would have cost them the conversation.
 *
 * ── Session persistence, and what it is actually for ──────────────────────
 * The `sessionId` is written to `localStorage` the moment the server issues it,
 * and the transcript beside it. The audience is on mid-range Android over
 * patchy connections; a dropped connection three turns into describing a
 * child's difficulties must resume, not restart. Nobody types that twice.
 *
 * Only the transcript and the id are stored — never a name, never the
 * constraints. `localStorage` is readable by anything running on the origin
 * and survives sign-out, so it holds the conversation and nothing about the
 * person having it.
 *
 * ── The turn cap is the server's ──────────────────────────────────────────
 * Six turns (FR-10.6), enforced by a counter in the server's loop. This
 * component reads `AGENT_LIMITS` from `/shared` to *show* how many remain —
 * a courtesy, not the limit. The two cannot drift because there is one
 * constant.
 *
 * ── Every screen degrades ─────────────────────────────────────────────────
 * `degradedToManualSearch` on any turn swaps the composer for `AiUnavailable`,
 * and `ManualSearchLink` sits under the transcript from the first render
 * regardless. A rate limit on turn four finds the escape hatch already there.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { AGENT_LIMITS } from '@shared/ai-contract';

import { AiUnavailable, ManualSearchLink } from './AiFallback';
import { ConstraintNotice } from './ConstraintNotice';
import { GapMap } from './GapMap';
import { ShortlistPanel } from './ShortlistPanel';
import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { Textarea } from '../ui/Field';
import { UserText } from '../ui/UserText';
import { api, ApiError } from '../../lib/api';

/** One key, one version. A shape change invalidates rather than half-restores. */
const STORAGE_KEY = 'ustaad.intake.v1';

function loadSaved() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved?.sessionId ? saved : null;
  } catch {
    // Corrupt or unavailable storage must never stop the feature working;
    // it only means this particular conversation starts fresh.
    return null;
  }
}

function save(state) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing, or a full quota. Not worth telling anybody about —
    // the conversation still works, it just will not survive a reload.
  }
}

function clearSaved() {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* see save() */
  }
}

/** One message. `role` is `family`, `agent` or `pending`. */
function Turn({ role, text }) {
  const { t } = useTranslation('ai');

  if (role === 'pending') {
    return (
      <li className="flex justify-start">
        <div
          className="max-w-[85%] rounded-control border border-slate-line bg-white px-3 py-2"
          role="status"
        >
          <span className="sr-only">{t('intake.thinking')}</span>
          <span aria-hidden="true" className="flex items-center gap-1.5 text-small text-slate">
            {t('intake.thinking')}
            <span className="flex gap-0.5">
              {/* Three dots, motion-safe only — a reduced-motion reader gets
                  the word "thinking" and no animation at all. */}
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1.5 w-1.5 rounded-full bg-slate motion-safe:animate-pulse"
                  style={{ animationDelay: `${index * 150}ms` }}
                />
              ))}
            </span>
          </span>
        </div>
      </li>
    );
  }

  const isFamily = role === 'family';

  return (
    <li className={isFamily ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[85%] rounded-control px-3 py-2',
          isFamily ? 'bg-ink text-white' : 'border border-slate-line bg-white text-ink',
        ].join(' ')}
      >
        {/*
          Both sides verbatim. The family's words are obviously theirs; the
          agent's reply quotes them back, and running either through anything
          that transforms text would break §2.10 in the one place a parent
          would definitely notice.
        */}
        <UserText className="text-small">{text}</UserText>
      </div>
    </li>
  );
}

export function IntakeConversation({ constraints = null, areaName = null, studentProfileId = null }) {
  const { t } = useTranslation(['ai', 'common']);

  const saved = useRef(loadSaved()).current;
  const [sessionId, setSessionId] = useState(saved?.sessionId ?? null);
  const [turns, setTurns] = useState(saved?.turns ?? []);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(saved?.result ?? null);
  const [degraded, setDegraded] = useState(null);
  const [userTurnCount, setUserTurnCount] = useState(saved?.userTurnCount ?? 0);

  const transcriptEnd = useRef(null);

  // Keep the newest turn in view without yanking the page — `nearest` scrolls
  // only if it has to, so somebody re-reading an earlier answer is left alone.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [turns.length]);

  useEffect(() => {
    if (sessionId) save({ sessionId, turns, result, userTurnCount });
  }, [sessionId, turns, result, userTurnCount]);

  const concluded =
    result?.decision === 'conclude' || result?.decision === 'insufficient_information';
  const turnsLeft = Math.max(0, AGENT_LIMITS.diagnosticMaxTurns - userTurnCount);

  function applyTurn(payload) {
    setTurns((current) => [
      ...current.filter((turn) => turn.role !== 'pending'),
      { role: 'agent', text: payload.reply },
    ]);
    setResult(payload);
    if (payload.degradedToManualSearch) setDegraded('busy');
  }

  /*
   * Starting is two calls, not one. `POST /ai/intake` creates the session and
   * returns its id and nothing else; the goal is then delivered as the first
   * turn, which is what produces a reply. Doing both here means the parent
   * types once and sees one answer — the two-step shape is the server's
   * business, not theirs.
   */
  const start = useMutation({
    mutationFn: async (goal) => {
      const created = await api.post('/ai/intake', { goal, studentProfileId });
      const first = await api.post(`/ai/intake/${created.sessionId}/turn`, {
        message: goal,
        ...(constraints ? { constraints } : {}),
      });
      return { sessionId: created.sessionId, first };
    },
    onSuccess: ({ sessionId: created, first }, goal) => {
      setSessionId(created);
      setUserTurnCount(1);
      setTurns([{ role: 'family', text: goal }, { role: 'agent', text: first.reply }]);
      setResult(first);
      if (first.degradedToManualSearch) setDegraded('busy');
    },
    onError: handleFailure,
  });

  const turn = useMutation({
    mutationFn: (text) =>
      api.post(`/ai/intake/${sessionId}/turn`, {
        message: text,
        ...(constraints ? { constraints } : {}),
      }),
    onSuccess: applyTurn,
    onError: handleFailure,
  });

  function handleFailure(error) {
    setTurns((current) => current.filter((item) => item.role !== 'pending'));

    /*
     * The server degrades rather than erroring, so reaching here means
     * something outside the AI path broke — the network, or a 429 from the
     * general limiter. Either way the person gets the manual route, not a
     * status code. `unclear` is reserved for a response that came back
     * unusable; everything else reads as "busy", which is true and does not
     * ask the reader to interpret anything.
     */
    setDegraded(error instanceof ApiError && error.status === 429 ? 'busy' : 'unclear');
  }

  function send(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;

    setMessage('');
    setDegraded(null);
    setTurns((current) => [...current, { role: 'family', text }, { role: 'pending' }]);

    if (!sessionId) {
      start.mutate(text);
      return;
    }
    setUserTurnCount((count) => count + 1);
    turn.mutate(text);
  }

  function restart() {
    clearSaved();
    setSessionId(null);
    setTurns([]);
    setResult(null);
    setDegraded(null);
    setUserTurnCount(0);
  }

  const busy = start.isPending || turn.isPending;

  return (
    <div className="space-y-4">
      {/* --- Transcript ------------------------------------------------- */}
      <Card>
        <CardBody>
          {turns.length === 0 ? (
            <div className="space-y-1">
              <h2 className="font-display text-subtitle text-ink">{t('intake.openingTitle')}</h2>
              <p className="text-small text-slate">{t('intake.openingBody')}</p>
            </div>
          ) : (
            <ul
              // `polite`, so a new answer is announced without cutting off
              // whatever the reader was already hearing.
              aria-live="polite"
              aria-label={t('intake.transcriptLabel')}
              className="space-y-2"
            >
              {turns.map((item, index) => (
                <Turn key={`${item.role}-${index}`} role={item.role} text={item.text} />
              ))}
              <li ref={transcriptEnd} aria-hidden="true" />
            </ul>
          )}
        </CardBody>
      </Card>

      {/* --- Composer, or the degraded path ------------------------------ */}
      {degraded ? (
        <AiUnavailable reasonKey={degraded} onRetry={() => setDegraded(null)} />
      ) : concluded ? null : (
        <form onSubmit={send} className="space-y-2">
          <label htmlFor="intake-message" className="sr-only">
            {t('intake.composerLabel')}
          </label>
          <Textarea
            id="intake-message"
            rows={3}
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t('intake.placeholder')}
            disabled={busy}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="submit" variant="accent" loading={busy} disabled={!message.trim()}>
              {sessionId ? t('intake.send') : t('intake.begin')}
            </Button>

            {/* The cap, shown rather than sprung. */}
            {sessionId ? (
              <p className="text-caption text-slate">
                {t('intake.turnsLeft', { count: turnsLeft })}
              </p>
            ) : null}
          </div>
        </form>
      )}

      {/* --- The finding -------------------------------------------------- */}
      {result?.gaps?.length || result?.insufficientInfo?.length ? (
        <GapMap gaps={result.gaps ?? []} insufficientInfo={result.insufficientInfo ?? []} />
      ) : null}

      {/*
        `insufficient_information` is a valid terminal outcome, not an error
        (FR-10.8). It gets the same honest hand-off as a failure, worded as
        what it is: we could not work it out from this.
      */}
      {result?.decision === 'insufficient_information' ? (
        <AiUnavailable reasonKey="insufficient" />
      ) : null}

      {/* --- Who applied the constraints, then the shortlist --------------- */}
      {result?.shortlist?.length ? (
        <>
          <ConstraintNotice constraints={constraints} areaName={areaName} />
          <ShortlistPanel shortlist={result.shortlist} />
        </>
      ) : null}

      {/* --- Always available, on every screen --------------------------- */}
      <div className="flex flex-wrap items-center gap-4">
        <ManualSearchLink />
        {sessionId ? (
          <button
            type="button"
            onClick={restart}
            className="min-h-tap text-small text-slate underline underline-offset-2"
          >
            {t('intake.startOver')}
          </button>
        ) : null}
      </div>

      {/* Session persistence, said once so a returning parent knows why
          their conversation is still here. */}
      {sessionId && saved?.sessionId === sessionId ? (
        <p className="text-caption text-slate">{t('intake.resumedNote')}</p>
      ) : null}
    </div>
  );
}
