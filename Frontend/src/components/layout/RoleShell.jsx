/**
 * The five role shells — Parent, Student, Tutor, Organisation, Administrator.
 *
 * ── Why a shell per role rather than one navigation that filters ───────────
 * A filtered navigation is a list of everything with some items hidden, and it
 * reads that way: a tutor sees a menu shaped around a parent's tasks with gaps
 * in it. Each role here gets a heading naming what this area *is* and a
 * sub-navigation of only its own work, so the interface answers "where am I"
 * before "what can I click".
 *
 * The administrator shell is deliberately the plainest. An administrator is
 * doing queue work — decisions that affect people and are written to an
 * append-only log — and a decorated console is the wrong register for that.
 */

import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';

/**
 * Each role's own navigation.
 *
 * Kept beside the shell rather than in the route table because these are
 * *within-area* links — the header's `NAV` answers "which area", this answers
 * "which task inside it".
 */
const SHELL_NAV = {
  parent: [
    { to: '/my/students', key: 'nav.myStudents' },
    { to: '/my/bookings', key: 'nav.myBookings' },
  ],
  student: [{ to: '/my/bookings', key: 'nav.myBookings' }],
  tutor: [
    { to: '/tutor/profile', key: 'nav.profile' },
    { to: '/tutor/schedule', key: 'nav.schedule' },
    { to: '/tutor/verification', key: 'nav.verification' },
  ],
  organisation: [
    { to: '/org/profile', key: 'nav.profile' },
    { to: '/org/vacancies', key: 'nav.orgVacancies' },
  ],
  /*
   * Eight queues, in the order they are worked: decisions about people first,
   * then the intake that feeds them, then the record. An operations tool is
   * navigated dozens of times an hour, so every queue is one click from every
   * other rather than nested behind the dashboard.
   */
  admin: [
    { to: '/admin', key: 'nav.dashboard', end: true },
    { to: '/admin/verifications', key: 'nav.verifications' },
    { to: '/admin/appeals', key: 'nav.appeals' },
    { to: '/admin/flags', key: 'nav.reports' },
    { to: '/admin/disputes', key: 'nav.disputes' },
    { to: '/admin/feedback', key: 'nav.feedback' },
    { to: '/admin/volunteers', key: 'nav.volunteers' },
    { to: '/admin/audit', key: 'nav.audit' },
  ],
};

const SHELL_TITLE = {
  parent: 'shell.parent',
  student: 'shell.student',
  tutor: 'shell.tutor',
  organisation: 'shell.organisation',
  admin: 'shell.admin',
};

export function RoleShell({ role }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const items = SHELL_NAV[role] ?? [];
  const wide = role === 'admin';

  return (
    <div className={`mx-auto ${wide ? 'max-w-wide' : 'max-w-wide'} px-4 py-6`}>
      <header className="mb-5 border-b border-slate-line pb-4">
        <p className="text-caption font-semibold uppercase tracking-wide text-verdigris-deep">
          {t(SHELL_TITLE[role])}
        </p>
        {user ? (
          <h1 className="mt-0.5 font-display text-title text-ink">{user.displayName}</h1>
        ) : null}

        {items.length > 1 ? (
          <nav aria-label={t(SHELL_TITLE[role])} className="mt-3">
            <ul className="flex flex-wrap gap-1">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      [
                        'flex min-h-tap items-center rounded-control px-3 text-small font-medium transition-colors',
                        isActive
                          ? 'bg-ink text-white'
                          : 'text-slate hover:bg-paper-sunk hover:text-ink',
                      ].join(' ')
                    }
                  >
                    {t(item.key)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>

      <Outlet />
    </div>
  );
}
