/**
 * The family's bookings — §6.8.
 *
 * Grouped by whether the booking still needs somebody to do something. A flat
 * reverse-chronological list buries the request awaiting a tutor's answer under
 * six months of completed sessions, and "what is happening right now" is the
 * only question this page is opened to answer.
 *
 * A completed **trial** with no fit check yet is called out separately: §6.20
 * says prompt the requester, and a prompt nobody sees is not a prompt.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { BookingCard } from '../../components/booking/BookingCard';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, SkeletonCard } from '../../components/ui/Card';
import { api } from '../../lib/api';

/** Still live — somebody's move. Everything else is history. */
const OPEN = new Set(['requested', 'confirmed', 'in_progress']);

export default function Bookings() {
  const { t } = useTranslation(['booking', 'common']);

  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => (await api.get('/bookings'))?.bookings ?? [],
  });

  const [open, past] = useMemo(() => {
    const items = bookings.data ?? [];
    return [items.filter((b) => OPEN.has(b.status)), items.filter((b) => !OPEN.has(b.status))];
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

  return (
    <div className="mx-auto max-w-prose space-y-6 px-4 py-6">
      <h1 className="font-display text-display text-ink">{t('list.familyTitle')}</h1>

      {(bookings.data ?? []).length === 0 ? (
        <EmptyState
          title={t('list.emptyTitle')}
          description={t('list.emptyBody')}
          action={
            <Button as={Link} to="/search" variant="accent">
              {t('list.findTutor')}
            </Button>
          }
        />
      ) : null}

      {open.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-subtitle text-ink">{t('list.open')}</h2>
          {open.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              to={`/my/bookings/${booking.id}`}
              counterpartyName={booking.tutorDisplayName ?? t('list.tutor')}
            />
          ))}
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-display text-subtitle text-ink">{t('list.past')}</h2>
          {past.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              to={`/my/bookings/${booking.id}`}
              counterpartyName={booking.tutorDisplayName ?? t('list.tutor')}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
