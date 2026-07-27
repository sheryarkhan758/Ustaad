/**
 * Lifecycle actions — §6.8, FR-8.4, FR-8.8.
 *
 * ── A state the server would reject is not clickable ───────────────────────
 * The permitted transitions come from `allowedTransitionsFrom` in
 * `@shared/booking-status` — **the same table the server calls** before every
 * status write. Not a copy of it, not a client-side approximation of it: the
 * identical exported function. A button that would produce a 409 is therefore
 * not rendered, and cannot drift into being rendered by somebody editing one
 * of two lists.
 *
 * This is a convenience, not the enforcement. `assertTransition` runs
 * server-side on every request and a hidden button is not a security control
 * (NFR-6) — but a person should not be offered a choice the system will refuse.
 *
 * ── Role narrows it further ────────────────────────────────────────────────
 * The state machine says what is *legal*; role says what is *sensible*. Only a
 * tutor confirms or declines a request addressed to her; only the requester
 * cancels their own. The server permits either party to make any state-legal
 * move, so this narrowing renders fewer actions than are allowed — which is
 * the safe direction. The reverse would put a button in front of somebody that
 * fails when pressed.
 *
 * ── Two refusals that need words ───────────────────────────────────────────
 *  · Cancelling and declining **require a reason** (the shared schema refuses
 *    without one), so both open a prompt rather than firing immediately. A
 *    booking that vanishes with no explanation is how a family decides the
 *    platform is not serious.
 *  · A tutor declining under one of her own declared conditions marks it as
 *    such, and that flag is only offered to her: it suppresses a statistic
 *    about her (SEC-21), and the server returns 403 `not_your_constraint` to
 *    anybody else. It must be set at the moment of the decline — the
 *    reliability job cannot reconstruct it afterwards.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { allowedTransitionsFrom } from '@shared/booking-status';

import { Button } from '../ui/Button';
import { Checkbox, Field, Textarea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';

/** Which side may sensibly make each move. See the header. */
const ACTOR_FOR = {
  confirmed: 'tutor',
  declined: 'tutor',
  in_progress: 'tutor',
  completed: 'tutor',
  no_show: 'both',
  cancelled: 'both',
};

/** These cannot be sent without a written reason — the schema refuses. */
const NEEDS_REASON = new Set(['cancelled', 'declined']);

export function BookingActions({ booking, viewerParty }) {
  const { t } = useTranslation(['booking', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [pending, setPending] = useState(null);
  const [reason, setReason] = useState('');
  const [underSafetyConstraint, setUnderSafetyConstraint] = useState(false);

  const transition = useMutation({
    mutationFn: (body) => api.post(`/bookings/${booking.id}/transition`, body),
    onSuccess: (_data, variables) => {
      toast.show({ tone: 'success', title: t(`lifecycle.done.${variables.to}`) });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      close();
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  function close() {
    setPending(null);
    setReason('');
    setUnderSafetyConstraint(false);
  }

  // The server's own table. A move absent here is a move the server refuses.
  const available = allowedTransitionsFrom(booking.status).filter((to) => {
    const actor = ACTOR_FOR[to];
    return actor === 'both' || actor === viewerParty;
  });

  if (available.length === 0) {
    return (
      <p className="text-caption text-slate">
        {t(`lifecycle.terminal.${booking.status}`, { defaultValue: t('lifecycle.noActions') })}
      </p>
    );
  }

  function run(to) {
    if (NEEDS_REASON.has(to)) {
      setPending(to);
      return;
    }
    transition.mutate({ to, declineUnderSafetyConstraint: false });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {available.map((to) => (
          <Button
            key={to}
            variant={to === 'confirmed' ? 'accent' : to === 'cancelled' || to === 'declined' ? 'ghost' : 'secondary'}
            onClick={() => run(to)}
            loading={transition.isPending && transition.variables?.to === to}
          >
            {t(`lifecycle.action.${to}`)}
          </Button>
        ))}
      </div>

      <Modal
        open={pending !== null}
        onClose={close}
        title={pending ? t(`lifecycle.action.${pending}`) : ''}
        description={t('lifecycle.reasonRequired')}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="accent"
              loading={transition.isPending}
              disabled={reason.trim().length === 0}
              onClick={() =>
                transition.mutate({
                  to: pending,
                  reason: reason.trim(),
                  declineUnderSafetyConstraint: underSafetyConstraint,
                })
              }
            >
              {pending ? t(`lifecycle.action.${pending}`) : ''}
            </Button>
          </>
        }
      >
        <Field label={t('lifecycle.reasonLabel')} htmlFor="transition-reason" required>
          {(props) => (
            <Textarea {...props}
              id="transition-reason"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>

        {/*
          Hers alone to set. SEC-21: it removes this decline from her
          confirmation-rate denominator, and nobody else may suppress a
          statistic about her.
        */}
        {pending === 'declined' && viewerParty === 'tutor' ? (
          <div className="mt-3">
            <Checkbox
              checked={underSafetyConstraint}
              onChange={(event) => setUnderSafetyConstraint(event.target.checked)}
              label={t('lifecycle.underSafetyConstraintLabel')}
              hint={t('lifecycle.underSafetyConstraintHint')}
            />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
