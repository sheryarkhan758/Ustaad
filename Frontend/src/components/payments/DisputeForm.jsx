/**
 * Raising a dispute — §6.31, FR-31.6.
 *
 * ── What a dispute is here ─────────────────────────────────────────────────
 * A written disagreement about a record, routed to an administrator who
 * resolves it with reasoning that lands in the append-only log (FR-31.7).
 * It is **not** a refund request and it is not a chargeback — the platform
 * never held the money, so there is nothing for it to return (§2.6). The
 * disclaimer above the form says so, because "dispute" is a word that carries
 * a payment-processor meaning everywhere else on the internet and a family
 * arriving here from that expectation will read it wrong.
 *
 * ── Validated by the server's own schema ───────────────────────────────────
 * `raiseDisputeSchema` moved out of the route file into `/shared` for exactly
 * this: the reason line has a 3-character floor and an 80-character ceiling,
 * and a family should learn that before writing, not after posting. The server
 * still validates — this copy is never trusted (NFR-6).
 *
 * The reason is short and required because it is what an administrator reads
 * first in the queue; the detail is long and optional because a reason line is
 * not the place to explain three months of disagreement. Both are user text:
 * stored unchanged, never translated (§2.10).
 */

import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { raiseDisputeSchema } from '@shared/payments';

import { Button } from '../ui/Button';
import { Field, Input, Textarea } from '../ui/Field';
import { FormErrorSummary } from '../form/FormErrorSummary';
import { useZodForm } from '../form/useZodForm';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

export function DisputeForm({ recordId, onDone, onCancel }) {
  const { t } = useTranslation(['payments', 'common']);
  const toast = useToast();

  const raise = useMutation({
    mutationFn: (body) => api.post(`/payments/${recordId}/disputes`, body),
  });

  const form = useZodForm({
    schema: raiseDisputeSchema,
    initialValues: { reason: '', detail: '' },
    onSubmit: async (values) => {
      await raise.mutateAsync(values);
      // The confirmation names the action the button named.
      toast.show({ tone: 'success', title: t('dispute.raised') });
      onDone?.();
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="space-y-4 rounded-control border border-slate-line bg-paper p-4"
    >
      <div>
        <h3 className="font-display text-subtitle text-ink">{t('dispute.heading')}</h3>
        {/* The word means something different here. Said before the fields. */}
        <p className="mt-0.5 text-caption text-slate">{t('dispute.notARefund')}</p>
      </div>

      <FormErrorSummary errors={form.errors} formError={form.formError} ref={form.summaryRef} />

      <Field
        label={t('dispute.reasonLabel')}
        hint={t('dispute.reasonHint')}
        error={form.errors.reason}
        required
        htmlFor="dispute-reason"
      >
        {(props) => (
          <Input {...props} id="dispute-reason" maxLength={80} {...form.field('reason')} />
        )}
      </Field>

      <Field
        label={t('dispute.detailLabel')}
        hint={t('dispute.detailHint')}
        error={form.errors.detail}
        htmlFor="dispute-detail"
      >
        {(props) => (
          <Textarea {...props} id="dispute-detail" rows={4} maxLength={2000} {...form.field('detail')} />
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="accent" loading={form.submitting}>
          {t('dispute.submit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common:action.cancel')}
        </Button>
      </div>
    </form>
  );
}
