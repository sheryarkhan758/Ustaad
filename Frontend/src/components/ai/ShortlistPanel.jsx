/**
 * The shortlist — §6.10, FR-10.10, FR-10.11.
 *
 * At most three tutors (`AGENT_LIMITS.shortlistSize`), each with the reason
 * they are here. The reason is the agent's — a classification of fit against
 * the gap it found — and every **number** beside it is the server's, read from
 * materialised columns (§2.8). The model names nobody it was not handed by the
 * search predicate.
 *
 * Ordering is the server's ranking, unchanged. Re-sorting client-side would
 * quietly detach the list from the deterministic score that `/t/:slug` explains
 * when a family clicks through, and the explanation would then describe a
 * position that is not the one they saw.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge, Card, CardBody } from '../ui/Card';
import { ArrowForward } from '../ui/Icon';
import { UserText } from '../ui/UserText';
import { useFormat } from '../../lib/format';

export function ShortlistPanel({ shortlist = [] }) {
  const { t } = useTranslation(['ai', 'search']);
  const fmt = useFormat();

  if (shortlist.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-subtitle text-ink">{t('shortlist.title')}</h2>
        <p className="mt-0.5 text-caption text-slate">{t('shortlist.subtitle')}</p>
      </div>

      <ul className="space-y-2">
        {shortlist.map((entry) => (
          <li key={entry.tutorId ?? entry.slug}>
            <Card interactive>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-display text-subtitle text-ink">
                    <Link to={`/t/${entry.slug}`} className="underline-offset-2 hover:underline">
                      {entry.displayName ?? entry.slug}
                    </Link>
                  </h3>

                  {/* Materialised, never computed here. */}
                  {entry.normalisedHourly ? (
                    <span className="font-mono text-small tnum text-ink">
                      {t('search:card.perHour', { amount: fmt.paisa(entry.normalisedHourly) })}
                    </span>
                  ) : null}
                </div>

                {/* The agent's reason for this tutor, in its own words. */}
                {entry.reason ? (
                  <UserText className="text-small text-slate">{entry.reason}</UserText>
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5">
                  {entry.verified ? <Badge tone="seal">{t('shortlist.verified')}</Badge> : null}
                  {entry.volunteer ? (
                    <Badge tone="settled">{t('search:card.volunteer')}</Badge>
                  ) : null}
                </div>

                <Link
                  to={`/t/${entry.slug}`}
                  className="inline-flex min-h-tap items-center gap-1.5 text-small font-medium text-verdigris-deep underline underline-offset-2"
                >
                  {t('shortlist.viewProfile')}
                  <ArrowForward size="sm" aria-hidden="true" />
                </Link>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
