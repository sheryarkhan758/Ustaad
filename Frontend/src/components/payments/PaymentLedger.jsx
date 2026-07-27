/**
 * The per-cycle payment record — §6.31, FR-31.1 to FR-31.7.
 *
 * ── A record of a cash transaction between two people ──────────────────────
 * Nothing here moves money. Each line is a statement two people can agree to:
 * an agreed amount, a travel charge recorded as a separate line (FR-31.2,
 * because it varies by the family's area rather than by the tuition), and two
 * acknowledgements.
 *
 * ── Both acknowledgements, or it is not settled ────────────────────────────
 * FR-31.4. The family marks it paid; the tutor confirms receipt; only then is
 * it `settled`. A one-sided claim is shown **as a claim** — "marked paid by the
 * family, awaiting the tutor's confirmation" — and never as a payment. That is
 * the entire value of the record: it is two-sided, and an interface that let a
 * single assertion look like a fact would have destroyed the thing it exists
 * to provide.
 *
 * The two acknowledgements are rendered as a pair of states with names, not as
 * a progress bar. A progress bar implies the second step follows the first
 * automatically, and it does not — a tutor who has not been paid does not
 * confirm, and that disagreement is exactly the signal the record is for.
 *
 * ── Only legal actions render ──────────────────────────────────────────────
 * The family sees "I have paid" only while it has not marked; the tutor sees
 * "I received this" only while she has not confirmed; the amount is editable
 * only while `isAgreedAmountLocked` is false — the same predicate the server
 * enforces with a 409, imported rather than reimplemented. A button that would
 * produce an error is not rendered.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { describeAcknowledgement, isAgreedAmountLocked } from '@shared/payment-status';

import { DisputeForm } from './DisputeForm';
import { PaymentBoundaryNotice } from './PaymentBoundaryNotice';
import { Badge, Card, CardBody, EmptyState, Table, Td, Th } from '../ui/Card';
import { Button } from '../ui/Button';
import { Check, Clock, Warning } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

const STATUS_TONE = {
  pending: 'neutral',
  family_marked: 'warning',
  settled: 'settled',
  disputed: 'flag',
};

/**
 * One side's acknowledgement, named.
 *
 * `done` is a fact with a person attached — "the family has marked this paid"
 * — rather than a tick that could be read as "the platform confirmed it".
 */
function Acknowledgement({ party, done }) {
  const { t } = useTranslation('payments');

  return (
    <li className="flex items-start gap-2">
      {done ? (
        <Check size="sm" className="mt-0.5 shrink-0 text-settled" aria-hidden="true" />
      ) : (
        <Clock size="sm" className="mt-0.5 shrink-0 text-slate" aria-hidden="true" />
      )}
      <span className={done ? 'text-small text-ink' : 'text-small text-slate'}>
        {t(`ack.${party}.${done ? 'done' : 'pending'}`)}
      </span>
    </li>
  );
}

function PaymentLine({ line, bookingId, viewerParty }) {
  const { t } = useTranslation(['payments', 'common']);
  const fmt = useFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [disputing, setDisputing] = useState(false);

  const ack = describeAcknowledgement({
    status: line.status,
    // The server sends the acknowledgement state already computed; the two
    // timestamps are reconstructed here only so the shared predicate — the one
    // the server itself uses — can be applied rather than re-derived.
    familyMarkedPaidAt: line.acknowledgement?.familyHasMarkedPaid ? new Date() : null,
    tutorConfirmedAt: line.acknowledgement?.tutorHasConfirmed ? new Date() : null,
  });

  const locked = isAgreedAmountLocked({
    status: line.status,
    familyMarkedPaidAt: ack.familyHasMarkedPaid ? new Date() : null,
    tutorConfirmedAt: ack.tutorHasConfirmed ? new Date() : null,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['payments', 'booking', bookingId] });

  const markPaid = useMutation({
    mutationFn: () => api.post(`/payments/${line.recordId}/mark-paid`, {}),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('action.markedPaid') });
      refresh();
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const confirmReceived = useMutation({
    mutationFn: () => api.post(`/payments/${line.recordId}/confirm-received`, {}),
    onSuccess: () => {
      toast.show({ tone: 'success', title: t('action.confirmedReceived') });
      refresh();
    },
    onError: (error) => toast.show({ tone: 'error', title: error.message }),
  });

  const openDispute = line.disputes?.find((d) => d.status === 'open' || d.status === 'under_review');

  return (
    <Card className={line.status === 'disputed' ? 'border-flag/40' : ''}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-subtitle text-ink">{line.cycleLabel}</h3>
            <p className="mt-0.5 text-caption text-slate">{ack.summary}</p>
          </div>
          <Badge tone={STATUS_TONE[line.status] ?? 'neutral'}>
            {t(`status.${line.status}`)}
          </Badge>
        </div>

        {/* --- The figures, itemised (FR-31.2) --------------------------- */}
        <Table caption={t('line.caption', { cycle: line.cycleLabel })}>
          <tbody>
            <tr>
              <Td>{t('line.agreedAmount')}</Td>
              <Td numeric>{fmt.paisa(line.agreedAmount)}</Td>
            </tr>
            {/*
              A separate line, always — never folded into the amount. It varies
              by where the family lives, not by the tuition, and a family
              comparing two tutors needs to see which part is which.
            */}
            <tr>
              <Td>{t('line.travelCharge')}</Td>
              <Td numeric>{fmt.paisa(line.travelCharge)}</Td>
            </tr>
            <tr>
              <Th>{t('line.total')}</Th>
              <Th numeric>{fmt.paisa(line.totalAgreed)}</Th>
            </tr>
          </tbody>
        </Table>

        {locked ? (
          <p className="text-caption text-slate">{t('line.amountLocked')}</p>
        ) : null}

        {/* --- Who has said what ----------------------------------------- */}
        <ul className="space-y-1.5">
          <Acknowledgement party="family" done={ack.familyHasMarkedPaid} />
          <Acknowledgement party="tutor" done={ack.tutorHasConfirmed} />
        </ul>

        {/* --- Actions: only the legal ones ------------------------------ */}
        <div className="flex flex-wrap gap-2">
          {viewerParty === 'family' && !ack.familyHasMarkedPaid && line.status !== 'disputed' ? (
            <Button variant="accent" loading={markPaid.isPending} onClick={() => markPaid.mutate()}>
              {t('action.markPaid')}
            </Button>
          ) : null}

          {viewerParty === 'tutor' && !ack.tutorHasConfirmed && line.status !== 'disputed' ? (
            <Button
              variant="accent"
              loading={confirmReceived.isPending}
              onClick={() => confirmReceived.mutate()}
            >
              {t('action.confirmReceived')}
            </Button>
          ) : null}

          {!openDispute ? (
            <Button variant="ghost" onClick={() => setDisputing((open) => !open)}>
              <Warning size="sm" />
              {t('dispute.open')}
            </Button>
          ) : null}
        </div>

        {/* --- A dispute already raised ---------------------------------- */}
        {openDispute ? (
          <div className="rounded-control border border-flag/30 bg-flag-soft px-3 py-2">
            <p className="text-caption font-semibold uppercase tracking-wide text-flag">
              {t(`dispute.status.${openDispute.status}`)}
            </p>
            {/* The reason is the person's own words (§2.10). */}
            <UserText className="mt-1 text-small text-ink">{openDispute.reason}</UserText>
            {openDispute.resolutionReason ? (
              <UserText className="mt-1 text-caption text-slate">
                {openDispute.resolutionReason}
              </UserText>
            ) : null}
          </div>
        ) : null}

        {disputing ? (
          <DisputeForm
            recordId={line.recordId}
            onDone={() => {
              setDisputing(false);
              refresh();
            }}
            onCancel={() => setDisputing(false)}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}

/**
 * @param {object} statement `{ lines[], totalSettled, totalOutstanding, disclaimer }`
 * @param {'family'|'tutor'} viewerParty Which acknowledgement this viewer owns.
 */
export function PaymentLedger({ statement, bookingId, viewerParty }) {
  const { t } = useTranslation('payments');
  const fmt = useFormat();

  const lines = statement?.lines ?? [];

  return (
    <section className="space-y-4">
      <h2 className="font-display text-subtitle text-ink">{t('ledger.title')}</h2>

      {/* Stated before the figures, not after them (SEC-23). */}
      <PaymentBoundaryNotice disclaimer={statement?.disclaimer} />

      {lines.length === 0 ? (
        <EmptyState title={t('ledger.emptyTitle')} description={t('ledger.emptyBody')} />
      ) : (
        <>
          <div className="space-y-3">
            {lines.map((line) => (
              <PaymentLine
                key={line.recordId}
                line={line}
                bookingId={bookingId}
                viewerParty={viewerParty}
              />
            ))}
          </div>

          {/*
            `totalSettled` counts only what both parties confirmed. A one-sided
            claim sits in outstanding — the statement must never promote an
            assertion into a fact.
          */}
          <Table caption={t('ledger.totalsCaption')}>
            <tbody>
              <tr>
                <Td>{t('ledger.totalSettled')}</Td>
                <Td numeric>{fmt.paisa(statement?.totalSettled ?? 0)}</Td>
              </tr>
              <tr>
                <Td>{t('ledger.totalOutstanding')}</Td>
                <Td numeric>{fmt.paisa(statement?.totalOutstanding ?? 0)}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-caption text-slate">{t('ledger.totalsNote')}</p>
        </>
      )}
    </section>
  );
}
