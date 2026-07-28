/**
 * The tutor's bookings — §6.8.
 *
 * The same data as the family's list, ordered by what she has to answer. A
 * request sitting unanswered is the one thing on this page with a clock on it:
 * a family that waits three days for a reply books somebody else, and her
 * confirmation rate records the silence.
 *
 * She never sees a trial fit check here or anywhere else (SEC-15). There is no
 * indicator that one exists, because "a fit check has been submitted" is itself
 * information about what the family thought.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { BookingCard } from '../../components/booking/BookingCard';
import { EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { api } from '../../lib/api';

const AWAITING_HER = new Set(['requested']);
const LIVE = new Set(['confirmed', 'in_progress']);

export default function TutorBookings() {
  const { t } = useTranslation(['booking', 'common']);

  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => (await api.get('/bookings'))?.bookings ?? [],
  });

  const [awaiting, live, past] = useMemo(() => {
    const items = bookings.data ?? [];
    return [
      items.filter((b) => AWAITING_HER.has(b.status)),
      items.filter((b) => LIVE.has(b.status)),
      items.filter((b) => !AWAITING_HER.has(b.status) && !LIVE.has(b.status)),
    ];
  }, [bookings.data]);

  if (bookings.isPending) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (bookings.isError) {
    return (
      <div className="mx-auto max-w-prose px-4 py-6">
        <ErrorState error={bookings.error} onRetry={bookings.refetch} />
      </div>
    );
  }

  const sections = [
    { key: 'awaiting', items: awaiting },
    { key: 'live', items: live },
    { key: 'past', items: past },
  ];

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <h1 className="font-display text-display text-ink">{t('list.tutorTitle')}</h1>

      {(bookings.data ?? []).length === 0 ? (
        <EmptyState title={t('list.tutorEmptyTitle')} description={t('list.tutorEmptyBody')} />
      ) : null}

      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <section key={section.key} className="space-y-3">
            <h2 className="font-display text-subtitle text-ink">{t(`list.${section.key}`)}</h2>
            {section.items.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                to={`/tutor/bookings/${booking.id}`}
                counterpartyName={booking.studentName ?? t('list.student')}
              />
            ))}
          </section>
        ))}
    </div>
  );
}
