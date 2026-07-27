/**
 * Booking entry points — §6.8, §6.30.
 *
 * ── The single session is a product, not a downgrade ───────────────────────
 * Every other tuition platform presents a one-off as the option you take when
 * you cannot commit — smaller type, listed last, framed as "just" a trial.
 * §6.30 is explicit that it is not that: "one hour on a specific topic" is a
 * complete thing a family may want. A student stuck on quadratics the week
 * before an exam does not want a monthly arrangement; she wants an hour on
 * quadratics.
 *
 * So all three options are the same size, in the same style, and the
 * single-session card names the actual use — a topic, an hour — rather than
 * describing itself in terms of what it lacks. It is listed **first**, because
 * it is the lowest-commitment way for a family to find out whether this tutor
 * is right, and a platform whose whole argument is verification should make
 * checking easy.
 *
 * FR-30.4 requires a declared purpose on a single session, which is why the
 * card asks for a topic rather than only a time.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Card, CardBody } from '../ui/Card';
import { ArrowForward, Clock } from '../ui/Icon';
import { useFormat } from '../../lib/format';

/**
 * The three shapes, in the order a family actually decides in.
 *
 * `short_term_package` sits between them: more than an hour, less than a
 * commitment — the exam-season shape.
 */
const OPTIONS = [
  {
    type: 'single_session',
    titleKey: 'booking.single.title',
    bodyKey: 'booking.single.body',
    forKey: 'booking.single.for',
  },
  {
    type: 'short_term_package',
    titleKey: 'booking.package.title',
    bodyKey: 'booking.package.body',
    forKey: 'booking.package.for',
  },
  {
    type: 'monthly',
    titleKey: 'booking.monthly.title',
    bodyKey: 'booking.monthly.body',
    forKey: 'booking.monthly.for',
  },
];

export function BookingOptions({ tutor, rates = [] }) {
  const { t } = useTranslation(['search', 'booking']);
  const fmt = useFormat();

  /** The cheapest rate offered for a shape, so each card can carry a figure. */
  const rateFor = (engagementType) => {
    const candidates = rates.filter((rate) => {
      if (engagementType === 'single_session') return rate.rateType === 'single_session';
      if (engagementType === 'monthly') {
        return rate.rateType === 'monthly' || rate.rateType === 'group_monthly';
      }
      return rate.rateType === 'hourly' || rate.rateType === 'single_session';
    });

    if (candidates.length === 0) return null;
    return candidates.reduce((cheapest, rate) => (rate.amount < cheapest.amount ? rate : cheapest));
  };

  const offered = new Set(tutor.engagementTypes ?? OPTIONS.map((option) => option.type));

  return (
    <div className="space-y-3">
      <h2 className="font-display text-subtitle text-ink">{t('booking.title')}</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.filter((option) => offered.has(option.type)).map((option) => {
          const rate = rateFor(option.type);

          return (
            <Card key={option.type} interactive className="flex">
              <CardBody className="flex w-full flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Clock size="sm" className="text-verdigris-deep" />
                  {/* Same weight for all three — see the header. */}
                  <h3 className="font-display text-subtitle text-ink">{t(option.titleKey)}</h3>
                </div>

                <p className="text-small text-slate">{t(option.bodyKey)}</p>

                <p className="text-caption text-verdigris-deep">{t(option.forKey)}</p>

                {rate ? (
                  <p className="mt-auto pt-2 font-mono text-small tnum text-ink">
                    {t('booking.from', { amount: fmt.paisa(rate.amount) })}
                  </p>
                ) : (
                  <p className="mt-auto pt-2 text-caption text-slate">{t('card.noRate')}</p>
                )}

                <Link
                  to={`/book/${tutor.slug}?engagementType=${option.type}`}
                  className="mt-2 inline-flex min-h-tap items-center justify-center gap-2 rounded-control bg-ink px-4 text-small font-medium text-white hover:bg-ink-deep"
                >
                  {t(`booking.action.${option.type}`)}
                  <ArrowForward size="sm" />
                </Link>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/*
        Stated once, near the money. SEC-23 and FR-31.10: the platform records
        what was agreed; it does not take the payment.
      */}
      <p className="text-caption text-slate">{t('booking.paymentNote')}</p>
    </div>
  );
}
