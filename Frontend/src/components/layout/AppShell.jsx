/**
 * The application shell: header, role-aware navigation, footer, and the two
 * persistent entry points that are real modules rather than decoration.
 *
 * ── The footer links are features, not boilerplate ─────────────────────────
 * The volunteer programme (§6.33) and the platform feedback channel (§6.32) are
 * both specified modules with their own database tables and administrator
 * queues. The feedback control is persistent because FR-32.1 asks for an entry
 * point on **every page** — a report route that is only reachable from a
 * settings screen is a route nobody uses at the moment something goes wrong.
 */

import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, Link } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useComparisonTray } from '../../context/ComparisonTrayContext';
import { navFor } from '../../routes';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Card';
import { FeedbackDialog } from './FeedbackDialog';
import { InstallPrompt } from '../../pwa/InstallPrompt';
import { LanguageToggle } from './LanguageToggle';
import { Close, Menu } from '../ui/Icon';

function Wordmark() {
  const { t } = useTranslation('common');
  return (
    <Link
      to="/"
      className="flex items-baseline gap-1.5 font-display text-title text-white"
      aria-label={t('brand.name') + t('brand.suffix')}
    >
      <span>{t('brand.name')}</span>
      <span className="text-verdigris" aria-hidden="true">
        {t('brand.suffix')}
      </span>
    </Link>
  );
}

function Header() {
  const { t } = useTranslation('common');
  const { user, role, isAuthenticated, logout } = useAuth();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = navFor(role);

  return (
    <header className="bg-ink text-white">
      <div className="mx-auto flex max-w-wide items-center justify-between gap-3 px-4 py-3">
        <Wordmark />

        <div className="flex items-center gap-2">
          {/* FR-27.2 — persists the choice and flips lang/dir on <html>. */}
          <LanguageToggle />

          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => logout(undefined, { onSettled: () => toast.forAction('signOut') })}
              className="hidden min-h-tap rounded-control px-3 text-small text-white/85 hover:bg-white/10 hover:text-white sm:block"
            >
              {t('action.signOut')}
            </button>
          ) : (
            <Link
              to="/login"
              className="hidden min-h-tap items-center rounded-control px-3 text-small text-white/85 hover:bg-white/10 hover:text-white sm:flex"
            >
              {t('action.signIn')}
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            className="flex h-tap w-tap items-center justify-center rounded-control hover:bg-white/10 md:hidden"
          >
            <span className="sr-only">{menuOpen ? t('nav.close') : t('nav.open')}</span>
            {menuOpen ? <Close /> : <Menu />}
          </button>
        </div>
      </div>

      <nav
        id="primary-navigation"
        aria-label={t('nav.primary')}
        className={`${menuOpen ? 'block' : 'hidden'} border-t border-white/10 md:block`}
      >
        <ul className="mx-auto flex max-w-wide flex-col px-2 pb-2 md:flex-row md:items-center md:gap-1 md:pb-0">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  [
                    'flex min-h-tap items-center rounded-control px-3 text-small font-medium transition-colors',
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-white/80 hover:bg-white/10 hover:text-white',
                  ].join(' ')
                }
              >
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}

          {user ? (
            <li className="md:ms-auto">
              <span className="flex min-h-tap items-center px-3 text-caption text-white/70">
                {user.displayName}
              </span>
            </li>
          ) : null}
        </ul>
      </nav>
    </header>
  );
}

/** The tray follows the user across the product — §6.18. */
function ComparisonTrayBar() {
  const { t } = useTranslation('common');
  const { count, max, clear } = useComparisonTray();
  if (count === 0) return null;

  return (
    <div className="sticky bottom-0 z-20 border-t border-slate-line bg-white px-4 py-2 shadow-action-bar">
      <div className="mx-auto flex max-w-wide items-center justify-between gap-3">
        <p className="text-small text-ink">{t('tray.selected', { count, max })}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('action.clear')}
          </Button>
          <Button size="sm" variant="accent">
            {t('action.compare')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Footer({ onOpenFeedback }) {
  const { t } = useTranslation('common');
  return (
    <footer className="mt-auto border-t border-slate-line bg-white">
      <div className="mx-auto grid max-w-wide gap-6 px-4 py-8 sm:grid-cols-2">
        <div>
          <p className="font-display text-subtitle text-ink">
            {t('brand.name')}
            {t('brand.suffix')}
          </p>
          <p className="mt-2 max-w-prose text-small text-slate">{t('footer.tagline')}</p>
          {/*
            SEC-23 and FR-31.10: stated wherever the platform's role could be
            misread, not only on the payment screens.
          */}
          <p className="mt-3 max-w-prose text-caption text-slate">
            {t('footer.paymentBoundary')}
          </p>
        </div>

        <nav aria-label={t('footer.heading')} className="sm:justify-self-end">
          <ul className="space-y-1">
            <li>
              {/* §6.33 — a real module with its own queue. */}
              <Link
                to="/volunteer"
                className="flex min-h-tap items-center text-small font-medium text-verdigris-deep hover:underline"
              >
                {t('footer.volunteer')}
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={onOpenFeedback}
                className="flex min-h-tap items-center text-small font-medium text-verdigris-deep hover:underline"
              >
                {t('footer.reportProblem')}
              </button>
            </li>
            <li>
              <Link
                to="/demo"
                className="flex min-h-tap items-center text-small text-slate hover:text-ink hover:underline"
              >
                {t('nav.demo')}
              </Link>
            </li>
            <li>
              <Link
                to="/styleguide"
                className="flex min-h-tap items-center text-small text-slate hover:text-ink hover:underline"
              >
                {t('footer.styleguide')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function AppShell() {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />

      <main id="main" className="flex-1 pb-action-bar sm:pb-0">
        {/*
          Every route is lazy, so a Suspense boundary is required. The fallback
          is a skeleton rather than a spinner: on a slow connection the shape of
          what is coming is more reassuring than an indeterminate circle.
        */}
        <Suspense
          fallback={
            <div className="mx-auto max-w-prose space-y-3 p-4">
              <SkeletonCard />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <ComparisonTrayBar />
      <Footer onOpenFeedback={() => setFeedbackOpen(true)} />

      {/* FR-32.1 — reachable from every page. */}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <InstallPrompt />
    </div>
  );
}
