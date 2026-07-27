/**
 * One booking, both sides — §6.8, §6.20, §6.31.
 *
 * The same page serves the family and the tutor. Which side is reading decides
 * three things and nothing else:
 *
 *  · which lifecycle actions are offered (`BookingActions`);
 *  · which payment acknowledgement is theirs to make (`PaymentLedger`);
 *  · whether the trial fit check is offered at all — it is the **family's**
 *    private answer and the tutor is never shown that it exists, let alone what
 *    it says (SEC-15).
 *
 * Everything else is one set of facts described once.
 *
 * ── The fit check is asked for, not hidden behind a menu ───────────────────
 * §6.20 says prompt the requester after a trial completes. A fit check nobody
 * is asked for is a fit check nobody fills in, and a trial that produces no
 * answer has told the family nothing they could not have guessed. So a
 * completed trial with no submitted check puts the form on the page.
 */

import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AddressDisclosure } from '../../components/booking/SafetyAndDisclosure';
import { BookingActions } from '../../components/booking/BookingActions';
import { EngagementReview } from '../../components/booking/EngagementReview';
import { FitCheckForm, FitCheckSummary } from '../../components/booking/FitCheck';
import { PaymentLedger } from '../../components/payments/PaymentLedger';
import { Badge, Card, CardBody, ErrorState, SkeletonCard, Table, Td, Th } from '../../components/ui/Card';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { useFormat } from '../../lib/format';

export default function BookingDetail() {
  const { id } = useParams();
  const { t } = useTranslation(['booking', 'common', 'search']);
  const fmt = useFormat();
  const { user } = useAuth();

  const viewerParty = user?.role === 'tutor' ? 'tutor' : 'family';

  const booking = useQuery({
    queryKey: ['booking', id],
    queryFn: async () => (await api.get(`/bookings/${id}`))?.booking ?? null,
    enabled: Boolean(id),
  });

  const statement = useQuery({
    queryKey: ['payments', 'booking', id],
    queryFn: () => api.get(`/payments/bookings/${id}`),
    enabled: Boolean(id),
  });

  /*
   * What she decides on — FR-29.13. Fetched for the tutor only, and only while
   * the request is still hers to answer: once it is confirmed the booking
   * record itself carries these facts alongside the address, and a second panel
   * repeating them would be noise.
   */
  const engagement = useQuery({
    queryKey: ['booking', id, 'engagement'],
    queryFn: async () => (await api.get(`/bookings/${id}/engagement`))?.engagement ?? null,
    enabled: Boolean(id) && viewerParty === 'tutor',
  });

  /* Her own declared conditions, to show as applied rather than merely held. */
  const safety = useQuery({
    queryKey: ['tutor', 'safety'],
    queryFn: async () => (await api.get('/tutors/safety'))?.safety ?? null,
    enabled: viewerParty === 'tutor',
  });

  /*
   * The tutor never asks for this, so the request is never made on her behalf.
   * The server would refuse it anyway; not asking means her network tab does
   * not carry a URL that implies the record exists (SEC-15).
   */
  const fitCheck = useQuery({
    queryKey: ['booking', id, 'fit-check'],
    queryFn: async () => (await api.get(`/bookings/${id}/fit-check`))?.fitCheck ?? null,
    enabled: Boolean(id) && viewerParty === 'family' && booking.data?.isTrial === true,
  });

  if (booking.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (booking.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-8">
        <ErrorState error={booking.error} onRetry={booking.refetch} />
      </div>
    );
  }

  const record = booking.data;
  if (!record) return null;

  const shapeKey =
    record.engagementType === 'short_term_package'
      ? 'package'
      : record.engagementType === 'single_session'
        ? 'single'
        : record.engagementType;

  const confirmed = ['confirmed', 'in_progress', 'completed'].includes(record.status);
  const trialAwaitingCheck =
    viewerParty === 'family' &&
    record.isTrial &&
    record.status === 'completed' &&
    !fitCheck.isPending &&
    !fitCheck.data;

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <div>
        <p className="text-small text-slate">
          <Link
            to={viewerParty === 'tutor' ? '/tutor/bookings' : '/my/bookings'}
            className="underline underline-offset-2"
          >
            {t('detail.back')}
          </Link>
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-display text-ink">
            {t(`search:booking.${shapeKey}.title`, { defaultValue: record.engagementType })}
          </h1>
          <Badge tone={record.status === 'completed' ? 'settled' : 'neutral'}>
            {t(`status.${record.status}`)}
          </Badge>
          {record.isTrial ? <Badge tone="neutral">{t('card.trial')}</Badge> : null}
        </div>
      </div>

      {/* --- The facts, once ---------------------------------------------- */}
      <Table caption={t('detail.summaryCaption')}>
        <tbody>
          {record.slotStart ? (
            <tr>
              <Th>{t('detail.when')}</Th>
              <Td>{fmt.dateTime(record.slotStart)}</Td>
            </tr>
          ) : null}
          <tr>
            <Th>{t('detail.mode')}</Th>
            <Td>{t(`common:mode.${record.mode}`)}</Td>
          </tr>
          {record.agreedRate !== null ? (
            <tr>
              <Th>{t('detail.agreedRate')}</Th>
              <Td numeric>{fmt.paisa(record.agreedRate)}</Td>
            </tr>
          ) : null}
          {record.travelChargeAgreed > 0 ? (
            <tr>
              <Th>{t('detail.travelCharge')}</Th>
              <Td numeric>{fmt.paisa(record.travelChargeAgreed)}</Td>
            </tr>
          ) : null}
          {record.guardianPresenceRequired ? (
            <tr>
              <Th>{t('detail.guardianPresence')}</Th>
              <Td>{t('detail.guardianPresenceValue')}</Td>
            </tr>
          ) : null}
        </tbody>
      </Table>

      {/*
        --- Her decision, before she makes it (§6.29.2) --------------------

        Placed above the lifecycle actions on purpose: the accept and decline
        buttons are three inches below, and the facts she needs to use them
        should not be something she has to scroll back up for.
      */}
      {viewerParty === 'tutor' && record.status === 'requested' ? (
        <EngagementReview engagement={engagement.data} safety={safety.data} />
      ) : null}

      {/* --- What each side sees, said to both (SEC-20) -------------------- */}
      {record.mode === 'home' ? (
        <AddressDisclosure audience={viewerParty} confirmed={confirmed} />
      ) : null}

      {/* --- Lifecycle: legal actions only --------------------------------- */}
      <Card>
        <CardBody className="space-y-3">
          <h2 className="font-display text-subtitle text-ink">{t('lifecycle.heading')}</h2>
          <BookingActions booking={record} viewerParty={viewerParty} />
          {record.cancelReason ? (
            <p className="text-caption text-slate">
              {t('lifecycle.reasonGiven', { reason: record.cancelReason })}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* --- Trial fit check: the family's, privately ---------------------- */}
      {trialAwaitingCheck ? <FitCheckForm bookingId={record.id} onDone={fitCheck.refetch} /> : null}
      {viewerParty === 'family' && fitCheck.data ? (
        <FitCheckSummary fitCheck={fitCheck.data} />
      ) : null}

      {/* --- Payment records ---------------------------------------------- */}
      {statement.isPending ? (
        <SkeletonCard label={t('common:state.loading')} />
      ) : (
        <PaymentLedger
          statement={statement.data}
          bookingId={record.id}
          viewerParty={viewerParty}
        />
      )}
    </div>
  );
}
