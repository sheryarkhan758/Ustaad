/**
 * One booking, summarised — §6.8.
 *
 * Shared by the family's list and the tutor's, because a booking is one thing
 * seen from two sides and duplicating the card would let the two drift into
 * describing it differently. What differs between the sides is the counterparty
 * name and which acknowledgement the viewer owns; the state, the times and the
 * shape are identical facts.
 *
 * The status badge carries a **word**, never colour alone — a red dot that
 * means "declined" is invisible to a third of readers in greyscale and to
 * anybody who has not learned the convention.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge, Card, CardBody } from '../ui/Card';
import { Clock } from '../ui/Icon';
import { useFormat } from '../../lib/format';

/** Tone per state. The word is what carries the meaning; this is support. */
const STATUS_TONE = {
  requested: 'neutral',
  confirmed: 'verdigris',
  in_progress: 'verdigris',
  completed: 'settled',
  cancelled: 'neutral',
  declined: 'neutral',
  no_show: 'flag',
};

export function BookingCard({ booking, counterpartyName = null, to }) {
  const { t } = useTranslation(['booking', 'common', 'search']);
  const fmt = useFormat();

  const shapeKey =
    booking.engagementType === 'short_term_package'
      ? 'package'
      : booking.engagementType === 'single_session'
        ? 'single'
        : booking.engagementType;

  return (
    <Card interactive>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-display text-subtitle text-ink">
              <Link to={to} className="underline-offset-2 hover:underline">
                {counterpartyName ?? t('card.untitled')}
              </Link>
            </h3>
            <p className="mt-0.5 text-caption text-slate">
              {t(`search:booking.${shapeKey}.title`, { defaultValue: booking.engagementType })}
              {booking.isTrial ? ` · ${t('card.trial')}` : ''}
            </p>
          </div>

          {/* A word, always. Never colour alone. */}
          <Badge tone={STATUS_TONE[booking.status] ?? 'neutral'}>
            {t(`status.${booking.status}`)}
          </Badge>
        </div>

        {booking.slotStart ? (
          <p className="flex items-center gap-1.5 font-mono text-small tnum text-ink">
            <Clock size="sm" className="text-slate" aria-hidden="true" />
            {fmt.dateTime(booking.slotStart)}
          </p>
        ) : null}

        <p className="text-caption text-slate">{t(`common:mode.${booking.mode}`)}</p>
      </CardBody>
    </Card>
  );
}
