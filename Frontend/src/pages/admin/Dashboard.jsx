/**
 * The administrator dashboard — §6.14, FR-14.3.
 *
 * ── Every number is a door ─────────────────────────────────────────────────
 * A dashboard that reports "7 pending verifications" and leaves you to find
 * them has added a step to the job rather than removed one. Each tile here is
 * the link into its own queue, so the count and the way in are one control.
 *
 * ── Counts, and nothing but counts ─────────────────────────────────────────
 * `GET /api/admin/dashboard` returns numbers only — no row, no id, no name
 * (§2.4). That is what lets an administrator-only screen read across the
 * unapproved-profile table without becoming a second listing surface, and it is
 * why this page cannot show "who" without going into the queue that owns them.
 *
 * ── Urgency is marked where it is real ─────────────────────────────────────
 * Safety-concern reviews and open appeals are tinted when they are non-zero.
 * Not everything is: a dashboard where every tile shouts is a dashboard nobody
 * reads. These two are the ones where a delay lands on a person — somebody
 * reporting a concern, and somebody contesting an automated verdict against
 * their livelihood.
 */

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { CountTile, QueuePage } from '../../components/admin/AdminPrimitives';
import { ErrorState, SkeletonCard } from '../../components/ui/Card';
import { api } from '../../lib/api';

/** Tile order is work order: decisions first, then intake, then the long tail. */
const TILES = [
  { key: 'pendingVerifications', to: '/admin/verifications' },
  { key: 'documentsAwaitingReview', to: '/admin/verifications' },
  { key: 'openVerificationAppeals', to: '/admin/appeals', tone: 'urgent' },
  { key: 'safetyConcernReviews', to: '/admin/feedback', tone: 'urgent' },
  { key: 'openFlags', to: '/admin/flags' },
  { key: 'openDisputes', to: '/admin/disputes' },
  { key: 'newFeedback', to: '/admin/feedback' },
  { key: 'newVolunteerApplications', to: '/admin/volunteers' },
  { key: 'pendingOrganisations', to: '/admin/organisations' },
  { key: 'expiringVerifications', to: '/admin/verifications' },
  { key: 'unmetDemandGaps', to: '/admin/demand' },
  { key: 'activeEngagements', to: '/admin/audit' },
];

export default function AdminDashboard() {
  const { t } = useTranslation(['admin', 'common']);

  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => (await api.get('/admin/dashboard'))?.counts ?? null,
    // An operations tool showing yesterday's queue is worse than a slow one.
    refetchOnWindowFocus: true,
  });

  if (dashboard.isPending) {
    return (
      <div className="mx-auto max-w-wide px-4 py-6">
        <SkeletonCard label={t('common:state.loading')} />
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <div className="mx-auto max-w-wide px-4 py-8">
        <ErrorState error={dashboard.error} onRetry={dashboard.refetch} />
      </div>
    );
  }

  const counts = dashboard.data ?? {};
  const byRole = counts.usersByRole ?? {};

  return (
    <QueuePage title={t('dashboard.title')} intro={t('dashboard.intro')}>
      <section aria-label={t('dashboard.countsCaption')}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {TILES.map((tile) => (
            <li key={tile.key}>
              <CountTile
                to={tile.to}
                label={t(`dashboard.${tile.key}`)}
                value={counts[tile.key] ?? 0}
                tone={tile.tone}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* FR-14.3's "totals by role" — a count per role, never a user list. */}
      <section aria-labelledby="accounts-heading" className="space-y-2">
        <h2 id="accounts-heading" className="font-display text-subtitle text-ink">
          {t('dashboard.usersByRole')}
        </h2>
        <div className="overflow-x-auto rounded-card border border-slate-line bg-white">
          <table className="w-full border-collapse text-small">
            <caption className="sr-only">{t('dashboard.accountsCaption')}</caption>
            <tbody>
              {Object.entries(byRole).map(([role, value]) => (
                <tr key={role} className="border-b border-slate-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-start font-medium text-ink">
                    {t(`common:role.${role}`, { defaultValue: role })}
                  </th>
                  <td className="px-3 py-2 text-end font-mono tnum text-ink">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </QueuePage>
  );
}
