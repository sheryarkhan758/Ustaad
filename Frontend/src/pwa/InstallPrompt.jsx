/**
 * Install-to-home-screen handling — §10.4, NFR-8.
 *
 * This is the mechanism by which a single codebase satisfies the project's
 * Android requirement, so it has to install and launch full-screen for real.
 *
 * ── Why the prompt is deferred rather than fired immediately ───────────────
 * Chrome hands us `beforeinstallprompt` and lets us choose the moment. Firing
 * it on first paint is the pattern everyone hates: a person who has not yet
 * seen what the site is gets a modal asking them to keep it. So the event is
 * captured, the browser's own banner suppressed, and our own quiet invitation
 * shown at the bottom of the page — where it can be ignored.
 *
 * ── Dismissal is remembered ────────────────────────────────────────────────
 * Someone who says no is not asked again for sixty days. Re-prompting a user
 * who declined is how an install banner becomes an ad.
 */

import { useCallback, useEffect, useState } from 'react';

const DISMISSED_KEY = 'ustaad.install.dismissedAt';
const QUIET_DAYS = 60;

function recentlyDismissed() {
  try {
    const raw = globalThis.localStorage?.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < QUIET_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** Registers the worker. Called once from `main.jsx`. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Dev has no built worker and registering one would serve a stale shell over
  // the Vite dev server, which is a confusing hour to debug.
  if (import.meta.env?.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration must never break the page. The app works without
      // it; it simply will not open offline.
    });
  });
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onBeforeInstall(event) {
      // Suppress the browser's own banner so ours can choose the moment.
      event.preventDefault();
      setDeferred(event);
      if (!recentlyDismissed()) setVisible(true);
    }

    function onInstalled() {
      setVisible(false);
      setDeferred(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      globalThis.localStorage?.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — it will ask again, which is the safe direction */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    setVisible(false);
    deferred.prompt();
    // The choice is recorded either way: someone who dismisses the native
    // dialogue has said no just as clearly as someone who dismisses ours.
    await deferred.userChoice.catch(() => null);
    setDeferred(null);
    dismiss();
  }, [deferred, dismiss]);

  if (!visible || !deferred) return null;

  return (
    <div
      role="complementary"
      aria-label="Install Ustaad.com"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-line bg-white px-4 py-3 shadow-action-bar pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-wide items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold text-ink">Add Ustaad to your home screen</p>
          <p className="mt-0.5 text-caption text-slate">
            Opens full screen and works without a connection.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-tap shrink-0 rounded-control px-3 text-small text-slate hover:bg-paper"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={install}
          className="min-h-tap shrink-0 rounded-control bg-ink px-4 text-small font-medium text-white hover:bg-ink-deep"
        >
          Add
        </button>
      </div>
    </div>
  );
}
