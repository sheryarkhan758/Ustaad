/**
 * The trial fit check — §6.20, SEC-15, decision 11.
 *
 * ── The privacy promise is the feature ─────────────────────────────────────
 * This is never shown to the tutor. Not on her profile, not in her statistics,
 * not as a ranking input, not in aggregate, not ever. The server enforces it —
 * `GET /api/bookings/:id/fit-check` is readable by the requesting family and
 * administrators only — and this component **states the promise on the form
 * itself**, in the same size as the questions.
 *
 * That sentence is not reassurance copy. A family that suspects the tutor will
 * read this writes "everything was fine" and the trial has produced nothing;
 * a family that knows she will not writes what actually happened, which is the
 * only reason the feature exists. The promise is what makes the answers true,
 * so it goes where the answers are typed rather than in a help page.
 *
 * ── Four dimensions and a decision ─────────────────────────────────────────
 * Communication, punctuality, engagement, pace — each 1–5 — and then the
 * question the trial was for: continue or not. The continue decision is a
 * radio pair rather than a checkbox, because "no" must be as easy to say as
 * "yes"; an unticked checkbox is a default, and a default is a thumb on the
 * scale.
 *
 * Validated by `trialFitCheckSchema` from `/shared` — the server's own object.
 */

import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { trialFitCheckSchema } from '@shared/booking';

import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { Field, Textarea } from '../ui/Field';
import { FormErrorSummary } from '../form/FormErrorSummary';
import { useZodForm } from '../form/useZodForm';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

const DIMENSIONS = ['communication', 'punctuality', 'engagement', 'pace'];
const SCORES = [1, 2, 3, 4, 5];

function ScoreRow({ dimension, value, onChange, error }) {
  const { t } = useTranslation('booking');
  const name = `fit-${dimension}`;

  return (
    <fieldset className="border-0 p-0">
      <legend className="text-small font-medium text-ink">
        {t(`fit.dimension.${dimension}`)}
      </legend>
      <p className="text-caption text-slate">{t(`fit.dimensionHint.${dimension}`)}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {SCORES.map((score) => (
          <label
            key={score}
            className={[
              'flex min-h-tap min-w-tap cursor-pointer items-center justify-center rounded-control border px-3 text-small tnum',
              value === score
                ? 'border-verdigris-deep bg-verdigris-deep text-white'
                : 'border-slate-line bg-white text-ink',
            ].join(' ')}
          >
            <input
              type="radio"
              name={name}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
              className="sr-only"
            />
            {score}
          </label>
        ))}
      </div>

      {error ? <p className="mt-1 text-caption text-flag">{error}</p> : null}
    </fieldset>
  );
}

export function FitCheckForm({ bookingId, onDone }) {
  const { t } = useTranslation(['booking', 'common']);
  const toast = useToast();

  const submit = useMutation({
    mutationFn: (body) => api.post(`/bookings/${bookingId}/fit-check`, body),
  });

  const form = useZodForm({
    schema: trialFitCheckSchema,
    initialValues: {
      communication: undefined,
      punctuality: undefined,
      engagement: undefined,
      pace: undefined,
      continueDecision: undefined,
      note: '',
    },
    onSubmit: async (values) => {
      await submit.mutateAsync(values);
      toast.show({ tone: 'success', title: t('fit.sent') });
      onDone?.();
    },
  });

  return (
    <Card>
      <CardBody>
        <form onSubmit={form.handleSubmit} noValidate className="space-y-5">
          <div>
            <h2 className="font-display text-subtitle text-ink">{t('fit.heading')}</h2>
            {/*
              Normal size, above the first question. See the header: this
              sentence is what makes the answers candid.
            */}
            <p className="mt-1 rounded-control border border-verdigris/25 bg-verdigris-soft px-3 py-2 text-small text-ink">
              {t('fit.privateNotice')}
            </p>
          </div>

          <FormErrorSummary errors={form.errors} formError={form.formError} ref={form.summaryRef} />

          <div className="space-y-4">
            {DIMENSIONS.map((dimension) => (
              <ScoreRow
                key={dimension}
                dimension={dimension}
                value={form.values[dimension]}
                onChange={(score) => form.setValue(dimension, score)}
                error={form.errors[dimension]}
              />
            ))}
          </div>

          {/* --- The question the trial was for --------------------------- */}
          <fieldset className="border-0 p-0">
            <legend className="text-small font-medium text-ink">{t('fit.continueLegend')}</legend>

            <div className="mt-2 flex flex-wrap gap-2">
              {/* Both options are equally weighted. See the header. */}
              {[true, false].map((choice) => (
                <label
                  key={String(choice)}
                  className={[
                    'flex min-h-tap cursor-pointer items-center gap-2 rounded-control border px-3 text-small',
                    form.values.continueDecision === choice
                      ? 'border-verdigris-deep bg-verdigris-soft text-ink'
                      : 'border-slate-line bg-white text-ink',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="continueDecision"
                    checked={form.values.continueDecision === choice}
                    onChange={() => form.setValue('continueDecision', choice)}
                    className="h-4 w-4 text-verdigris-deep focus:ring-verdigris-deep"
                  />
                  {t(`fit.continue.${choice ? 'yes' : 'no'}`)}
                </label>
              ))}
            </div>

            {form.errors.continueDecision ? (
              <p className="mt-1 text-caption text-flag">{form.errors.continueDecision}</p>
            ) : null}
          </fieldset>

          <Field
            label={t('fit.noteLabel')}
            hint={t('fit.noteHint')}
            error={form.errors.note}
            htmlFor="fit-note"
          >
            {(props) => (
              <Textarea {...props} id="fit-note" rows={4} maxLength={2000} {...form.field('note')} />
            )}
          </Field>

          <Button type="submit" variant="accent" loading={form.submitting}>
            {t('fit.submit')}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** The submitted answers, read back to the family that wrote them. */
export function FitCheckSummary({ fitCheck }) {
  const { t } = useTranslation('booking');
  if (!fitCheck) return null;

  return (
    <Card>
      <CardBody className="space-y-2">
        <h2 className="font-display text-subtitle text-ink">{t('fit.submittedHeading')}</h2>
        <p className="text-caption text-slate">{t('fit.privateNotice')}</p>

        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-small">
          {DIMENSIONS.map((dimension) => (
            <div key={dimension} className="contents">
              <dt className="text-slate">{t(`fit.dimension.${dimension}`)}</dt>
              <dd className="text-end font-mono tnum text-ink">{fitCheck[dimension]}/5</dd>
            </div>
          ))}
          <dt className="text-slate">{t('fit.continueLegend')}</dt>
          <dd className="text-end text-ink">
            {t(`fit.continue.${fitCheck.continueDecision ? 'yes' : 'no'}`)}
          </dd>
        </dl>
      </CardBody>
    </Card>
  );
}
