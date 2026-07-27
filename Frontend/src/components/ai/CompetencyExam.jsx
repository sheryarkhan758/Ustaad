/**
 * Competency verification, from the tutor's side — §6.11, §6.28.
 *
 * ── An examination that respects the person sitting it ────────────────────
 * A qualified teacher is being asked to prove she can teach a topic she has
 * taught for years, by an automated system, with her livelihood attached to
 * the outcome. Everything about this screen follows from taking that
 * seriously:
 *
 *  · **The stakes and the rules are stated before she starts, not after.**
 *    How many items, how many attempts, what happens on a pass, what happens
 *    on a failure, and that she may appeal. An examination whose rules appear
 *    only in the result is not an examination, it is a trap.
 *  · **The verdict comes with its reasoning**, and the reasoning quotes her
 *    own answers. "Not passed" with no account of why is unappealable in
 *    practice even where an appeal exists on paper.
 *  · **An administrator can override the automated verdict**, and that is
 *    stated on the failure screen rather than buried in a help page. It is the
 *    single most important thing a failed tutor needs to know, and the thing
 *    she is least likely to assume.
 *  · **A failure is not a judgement of her.** It is a result for one topic, on
 *    one attempt, and the copy says so. The rest of her profile is untouched.
 *
 * ── What the model does and does not decide ───────────────────────────────
 * The model grades classifications only — correct or not, reasoned or
 * asserted, pitched for the student or for the tutor. `shared/competency.ts`
 * computes the mark in code (FR-11.5), so the same answers always produce the
 * same result and she can be told exactly why. The screen says this, because
 * "an AI decided" and "a rule decided, from an AI's reading" are different
 * claims and only one of them is true here.
 *
 * The rubric score itself is never shown: FR-11.5's figure is internal, and a
 * number would invite exactly the haggling the reasoning is meant to replace.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { AGENT_LIMITS } from '@shared/ai-contract';
import { submitAnswersSchema } from '@shared/ai-requests';

import { AiUnavailable } from './AiFallback';
import { Button } from '../ui/Button';
import { Badge, Card, CardBody } from '../ui/Card';
import { Field, Textarea } from '../ui/Field';
import { Check, Close, Warning } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

/** Stated up front. See the header — rules that appear after are not rules. */
function Rules({ isAppeal }) {
  const { t } = useTranslation('ai');

  return (
    <ul className="space-y-1.5 text-small text-ink">
      <li>{t('exam.rules.items')}</li>
      <li>{t('exam.rules.graded')}</li>
      <li>{t('exam.rules.onPass')}</li>
      <li>{t('exam.rules.onFail')}</li>
      <li>{t('exam.rules.override')}</li>
      {isAppeal ? <li className="font-medium">{t('exam.rules.appealOnly')}</li> : null}
    </ul>
  );
}

export function CompetencyExam({ claim, onFinished }) {
  const { t } = useTranslation(['ai', 'common']);
  const toast = useToast();

  const [session, setSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [outcome, setOutcome] = useState(null);
  const [failed, setFailed] = useState(null);
  const [isAppeal, setIsAppeal] = useState(false);

  const start = useMutation({
    mutationFn: (appeal) =>
      api.post('/ai/verification', {
        claimId: claim.id,
        topicId: claim.topicId,
        isAppeal: appeal,
      }),
    onSuccess: (payload) => {
      setSession(payload);
      setAnswers({});
      setOutcome(null);
      setFailed(null);
    },
    onError: () => setFailed('busy'),
  });

  const submit = useMutation({
    mutationFn: (body) => api.post(`/ai/verification/${session.sessionId}/answers`, body),
    onSuccess: (payload) => {
      setOutcome(payload);
      if (payload.finished) onFinished?.(payload);
      toast.show({
        tone: payload.verdict === 'passed' ? 'success' : 'info',
        title: t(`exam.toast.${payload.verdict === 'passed' ? 'passed' : 'notPassed'}`),
      });
    },
    onError: () => setFailed('busy'),
  });

  function sendAnswers(event) {
    event.preventDefault();

    const body = {
      answers: (session.items ?? []).map((item) => ({
        itemId: item.id,
        answer: answers[item.id] ?? '',
      })),
    };

    // The server's own schema. A blank answer is permitted — she may not know
    // one, and refusing to submit would be the interface deciding she should
    // guess.
    const parsed = submitAnswersSchema.safeParse(body);
    if (!parsed.success) return;

    submit.mutate(parsed.data);
  }

  /* --- The provider is down ------------------------------------------- */
  if (failed) {
    return (
      <AiUnavailable reasonKey={failed} onRetry={() => setFailed(null)}>
        {/* Her claim is untouched by this. Worth saying — she has just been
            told the thing that decides her badge is unavailable. */}
        <p className="text-small text-ink">{t('exam.unavailableClaimSafe')}</p>
      </AiUnavailable>
    );
  }

  /* --- The verdict ------------------------------------------------------ */
  if (outcome?.finished) {
    const passed = outcome.verdict === 'passed';

    return (
      <Card className={passed ? 'border-settled/40' : 'border-seal/40'}>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            {passed ? (
              <Check size="sm" className="mt-1 shrink-0 text-settled" aria-hidden="true" />
            ) : (
              <Close size="sm" className="mt-1 shrink-0 text-seal-deep" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-subtitle text-ink">
                {t(`exam.verdict.${passed ? 'passed' : 'notPassed'}.title`, {
                  topic: claim.topicName ?? claim.topicId,
                })}
              </h2>
              <p className="mt-0.5 text-small text-slate">
                {t(`exam.verdict.${passed ? 'passed' : 'notPassed'}.body`)}
              </p>
            </div>
          </div>

          {/*
            The reasoning, quoting her own answers. This is what makes an
            appeal possible in practice rather than only on paper.
          */}
          {outcome.reasoning ? (
            <div className="rounded-control border border-slate-line bg-paper px-3 py-2.5">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
                {t('exam.reasoningHeading')}
              </h3>
              <UserText className="mt-1 text-small text-ink">{outcome.reasoning}</UserText>
            </div>
          ) : null}

          <p className="text-caption text-slate">{t('exam.markedInCode')}</p>

          {!passed ? (
            <div className="space-y-3 rounded-control border border-seal/30 bg-seal-soft px-3 py-3">
              {/*
                The most important sentence on the screen, and the one she is
                least likely to assume. FR-28.3, SEC-18.
              */}
              <p className="text-small text-ink">{t('exam.appeal.overrideNote')}</p>
              <p className="text-caption text-slate">{t('exam.appeal.oncePerClaim')}</p>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="accent"
                  loading={start.isPending}
                  onClick={() => {
                    setIsAppeal(true);
                    start.mutate(true);
                  }}
                >
                  {t('exam.appeal.action')}
                </Button>
              </div>

              <p className="text-caption text-slate">{t('exam.appeal.restOfProfile')}</p>
            </div>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  /* --- Sitting it -------------------------------------------------------- */
  if (session) {
    return (
      <Card>
        <CardBody>
          <form onSubmit={sendAnswers} className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-subtitle text-ink">
                {claim.topicName ?? claim.topicId}
              </h2>
              {isAppeal ? <Badge tone="seal">{t('exam.appealBadge')}</Badge> : null}
            </div>

            {(session.items ?? []).map((item, index) => (
              <Field
                key={item.id}
                label={t('exam.itemLabel', {
                  index: index + 1,
                  total: session.items.length,
                })}
                htmlFor={`item-${item.id}`}
              >
                {(props) => (
                  <>
                    {/* The question is authored content from the model, shown
                        verbatim — she is being examined on this exact wording. */}
                    <UserText className="mb-2 text-small text-ink">{item.question}</UserText>
                    <Textarea
                      {...props}
                      id={`item-${item.id}`}
                      rows={5}
                      maxLength={4000}
                      value={answers[item.id] ?? ''}
                      onChange={(event) =>
                        setAnswers((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                      placeholder={t('exam.answerPlaceholder')}
                    />
                  </>
                )}
              </Field>
            ))}

            {/* How she is being read, said where she is writing. */}
            <p className="text-caption text-slate">{t('exam.explainHint')}</p>

            <Button type="submit" variant="accent" loading={submit.isPending}>
              {t('exam.submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  /* --- Before she starts -------------------------------------------------- */
  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="font-display text-subtitle text-ink">
            {t('exam.startTitle', { topic: claim.topicName ?? claim.topicId })}
          </h2>
          <p className="mt-0.5 text-small text-slate">{t('exam.startBody')}</p>
        </div>

        <div className="rounded-control border border-slate-line bg-paper px-3 py-3">
          <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
            {t('exam.rulesHeading')}
          </h3>
          <div className="mt-2">
            <Rules isAppeal={false} />
          </div>
        </div>

        <p className="flex items-start gap-2 text-caption text-slate">
          <Warning size="sm" className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('exam.maxExchanges', { count: AGENT_LIMITS.verificationMaxTurns })}
        </p>

        <Button variant="accent" loading={start.isPending} onClick={() => start.mutate(false)}>
          {t('exam.begin')}
        </Button>
      </CardBody>
    </Card>
  );
}
