/**
 * The route table, grouped by who may reach each group.
 *
 * ── Public is the largest group, deliberately ──────────────────────────────
 * Browsing, search, tutor profiles, the vacancy board and the whole
 * demonstration panel require **no account** (FR-1.6, FR-13.6, FR-15.1). A
 * parent should be able to evaluate this platform completely before deciding
 * whether to trust it with a child's name — and someone assessing the project
 * should not have to register to see whether it works.
 *
 * ── Everything is lazy except the shell ────────────────────────────────────
 * The audience is on mid-range Android over patchy connections. An admin
 * dashboard a parent will never open should not be in the bundle a parent
 * downloads. `React.lazy` per route group is the cheapest way to hold that line
 * as the product grows.
 */

import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import { AppShell } from '../components/layout/AppShell';
import { RouteError } from '../components/layout/RouteError';
import { RoleShell } from '../components/layout/RoleShell';
import { OPEN_NAVIGATION } from './access';
import { RoleGuard } from './RoleGuard';

const page = (loader) => ({ Component: lazy(loader) });

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    /*
     * Without this, a thrown render error or a dead API gets React Router's
     * developer screen — a stack trace addressed to whoever wrote the code,
     * shown to a parent looking for a tutor. See `RouteError`.
     */
    errorElement: <RouteError />,
    children: [
      /* --- Public — no account required --------------------------------- */
      { index: true, ...page(() => import('../pages/public/Landing')) },
      /*
       * The diagnostic is the front door (§6.10). It requires an account —
       * the page says so before the composer rather than after four
       * paragraphs — but the route itself is public so the explanation and
       * the manual-search fallback are reachable without signing in.
       */
      { path: 'intake', ...page(() => import('../pages/public/Intake')) },
      /*
       * The platform's primary use case gets its own route, not a query string
       * on `/search` (§2.1, decision 15, FR-29.1). A link a family can be given
       * over the phone — "go to ustaad.com/home-tuition" — is part of what
       * makes it an entry point rather than a filter.
       */
      { path: 'home-tuition', ...page(() => import('../pages/public/HomeTuition')) },
      { path: 'search', ...page(() => import('../pages/public/Search')) },
      /*
       * `/t/:slug` is canonical — it is what the QR code encodes and what a
       * tutor prints (§6.21). Short enough to read aloud and to fit a small
       * code at high error correction. `/tutors/:slug` still resolves so
       * anything already linking there keeps working.
       */
      { path: 't/:slug', ...page(() => import('../pages/public/TutorProfile')) },
      { path: 'tutors/:slug', ...page(() => import('../pages/public/TutorProfile')) },
      { path: 'vacancies', ...page(() => import('../pages/public/Vacancies')) },
      { path: 'volunteer', ...page(() => import('../pages/public/Volunteer')) },
      { path: 'demo', ...page(() => import('../pages/public/Demo')) },
      { path: 'login', ...page(() => import('../pages/public/Login')) },
      { path: 'register', ...page(() => import('../pages/public/Register')) },
      { path: 'forgot-password', ...page(() => import('../pages/public/ForgotPassword')) },
      { path: 'styleguide', ...page(() => import('../pages/Styleguide')) },

      /* --- Parent -------------------------------------------------------- */
      {
        element: <RoleGuard allow={['parent']} />,
        children: [
          {
            element: <RoleShell role="parent" />,
            children: [
              { path: 'my/students', ...page(() => import('../pages/parent/Students')) },
              {
                path: 'my/progress/:studentProfileId',
                ...page(() => import('../pages/parent/Progress')),
              },
              /* The countdown and the timeline — §6.25 and §6.26 together. */
              {
                path: 'my/plan/:studentProfileId',
                ...page(() => import('../pages/parent/StudyPlan')),
              },
            ],
          },
        ],
      },

      /* --- Parent and adult student share the booking list ---------------- */
      {
        element: <RoleGuard allow={['parent', 'student']} />,
        children: [
          {
            element: <RoleShell role="parent" />,
            children: [
              { path: 'my/bookings', ...page(() => import('../pages/parent/Bookings')) },
              /*
               * The detail page is one component serving both sides — see its
               * header. It is reachable at two paths so each role's list can
               * link within its own shell, and it decides what to offer from
               * the signed-in role rather than from the URL.
               */
              {
                path: 'my/bookings/:id',
                ...page(() => import('../pages/booking/BookingDetail')),
              },
              { path: 'book/:slug', ...page(() => import('../pages/book/BookTutor')) },
              { path: 'my/students', ...page(() => import('../pages/parent/Students')) },
              /*
               * The ledger hangs off the student, not off a booking: it is the
               * record across every session anyone has taught them (§6.12).
               */
              {
                path: 'my/students/:studentProfileId/progress',
                ...page(() => import('../pages/parent/Progress')),
              },
              { path: 'my/groups', ...page(() => import('../pages/parent/Groups')) },
            ],
          },
        ],
      },

      /* --- Tutor -------------------------------------------------------- */
      {
        element: <RoleGuard allow={['tutor']} />,
        children: [
          {
            element: <RoleShell role="tutor" />,
            children: [
              { path: 'tutor/profile', ...page(() => import('../pages/tutor/Profile')) },
              { path: 'tutor/schedule', ...page(() => import('../pages/tutor/Schedule')) },
              { path: 'tutor/verification', ...page(() => import('../pages/tutor/Verification')) },
              /*
               * Competency is a separate route from identity verification on
               * purpose. FR-6.2 keeps the two tracks apart and never merges
               * them into one badge; two screens is the honest expression of
               * that.
               */
              { path: 'tutor/competency', ...page(() => import('../pages/tutor/Competency')) },
              { path: 'tutor/bookings', ...page(() => import('../pages/tutor/Bookings')) },
              {
                path: 'tutor/bookings/:id',
                ...page(() => import('../pages/booking/BookingDetail')),
              },
              { path: 'tutor/groups', ...page(() => import('../pages/tutor/Groups')) },
              /*
               * The demand board is supply intelligence, so it lives in the
               * tutor's own area rather than as a public page (§6.24). An
               * organisation reads the same screen (FR-13.7) through its own
               * route below.
               */
              { path: 'tutor/demand', ...page(() => import('../pages/demand/DemandBoard')) },
            ],
          },
        ],
      },

      /* --- Organisation — trimmed by decision 4 ------------------------- */
      {
        element: <RoleGuard allow={['organisation']} />,
        children: [
          {
            element: <RoleShell role="organisation" />,
            children: [
              { path: 'org/profile', ...page(() => import('../pages/organisation/Profile')) },
              { path: 'org/vacancies', ...page(() => import('../pages/organisation/Vacancies')) },
              /*
               * FR-13.7 — the same board a tutor reads, as hiring intelligence.
               * The same component and the same endpoint: what makes a board
               * carrying no requester identity safe to show a tutor makes it
               * safe to show an academy, and one surface cannot drift from two.
               */
              { path: 'org/demand', ...page(() => import('../pages/demand/DemandBoard')) },
            ],
          },
        ],
      },

      /* --- Administrator ------------------------------------------------ */
      {
        element: <RoleGuard allow={['admin']} />,
        children: [
          {
            element: <RoleShell role="admin" />,
            children: [
              { path: 'admin', ...page(() => import('../pages/admin/Dashboard')) },
              { path: 'admin/verifications', ...page(() => import('../pages/admin/Verifications')) },
              /*
               * One component serves the queue and one tutor's dossier. They
               * are the same task at two depths — an administrator working a
               * list opens a row, decides, and comes back — and splitting them
               * across two files would duplicate the badge preview, which is
               * the one thing that must not exist twice.
               */
              {
                path: 'admin/verifications/:tutorId',
                ...page(() => import('../pages/admin/Verifications')),
              },
              { path: 'admin/flags', ...page(() => import('../pages/admin/Flags')) },
              { path: 'admin/disputes', ...page(() => import('../pages/admin/Disputes')) },
              { path: 'admin/feedback', ...page(() => import('../pages/admin/Feedback')) },
              { path: 'admin/volunteers', ...page(() => import('../pages/admin/Volunteers')) },
              { path: 'admin/appeals', ...page(() => import('../pages/admin/Appeals')) },
              { path: 'admin/audit', ...page(() => import('../pages/admin/AuditLog')) },
              /* The same board a tutor reads, as supply intelligence (FR-24.4). */
              { path: 'admin/demand', ...page(() => import('../pages/demand/DemandBoard')) },
            ],
          },
        ],
      },

      { path: '*', ...page(() => import('../pages/public/NotFound')) },
    ],
  },
]);

/**
 * The navigation model, in one place.
 *
 * The header reads this rather than hard-coding links, so a route added above
 * with a `nav` entry appears for the right roles automatically — and a route
 * without one stays out of the navigation, which is what most routes want.
 *
 * `labelKey` rather than `label`: FR-27.1 requires every interface string to
 * come from the dictionary, and a nav array is exactly the place a hard-coded
 * English word survives a translation pass unnoticed.
 */
export const NAV = [
  /*
   * Home, first and explicit.
   *
   * The wordmark links here, which is the convention — and a convention is not
   * an affordance. It is unlabelled, it is not in the navigation list a screen
   * reader reads out, and on a phone it sits at the opposite end of the header
   * from the menu somebody just opened. A signed-in user four screens deep had
   * no obvious way back to the front page.
   *
   * `end: true` so it is only marked current on `/` itself, rather than on
   * every route beneath it.
   */
  { to: '/', labelKey: 'nav.home', roles: null, end: true },
  { to: '/intake', labelKey: 'nav.intake', roles: null },
  { to: '/search', labelKey: 'nav.search', roles: null },
  { to: '/vacancies', labelKey: 'nav.vacancies', roles: null },
  { to: '/demo', labelKey: 'nav.demo', roles: null },

  { to: '/my/bookings', labelKey: 'nav.myBookings', roles: ['parent', 'student'] },
  { to: '/my/students', labelKey: 'nav.myStudents', roles: ['parent'] },
  { to: '/my/groups', labelKey: 'nav.myGroups', roles: ['parent', 'student'] },

  { to: '/tutor/profile', labelKey: 'nav.profile', roles: ['tutor'] },
  { to: '/tutor/bookings', labelKey: 'nav.tutorBookings', roles: ['tutor'] },
  { to: '/tutor/schedule', labelKey: 'nav.schedule', roles: ['tutor'] },
  { to: '/tutor/verification', labelKey: 'nav.verification', roles: ['tutor'] },
  { to: '/tutor/competency', labelKey: 'nav.competency', roles: ['tutor'] },
  { to: '/tutor/groups', labelKey: 'nav.groupProposals', roles: ['tutor'] },
  { to: '/tutor/demand', labelKey: 'nav.demand', roles: ['tutor'] },

  { to: '/org/vacancies', labelKey: 'nav.orgVacancies', roles: ['organisation'] },
  { to: '/org/profile', labelKey: 'nav.orgProfile', roles: ['organisation'] },
  { to: '/org/demand', labelKey: 'nav.demand', roles: ['organisation'] },

  { to: '/admin', labelKey: 'nav.dashboard', roles: ['admin'] },
  { to: '/admin/verifications', labelKey: 'nav.verifications', roles: ['admin'] },
  { to: '/admin/flags', labelKey: 'nav.reports', roles: ['admin'] },
];

/**
 * `roles: null` means everyone, signed in or not.
 *
 * Under `OPEN_NAVIGATION` a signed-in person sees every item regardless of
 * their own role — the demonstration convenience described in `access.js`.
 * Anonymous visitors are unaffected either way: they see the public items,
 * which is exactly the set FR-1.6 promises without an account.
 */
export function navFor(role) {
  if (OPEN_NAVIGATION && role) return NAV;
  return NAV.filter((item) => item.roles === null || (role && item.roles.includes(role)));
}
