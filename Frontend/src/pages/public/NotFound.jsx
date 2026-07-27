/**
 * 404.
 *
 * Offers the next move rather than an apology. A dead end on a phone is where
 * people close the tab.
 */

import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-prose px-4 py-16 text-center">
      <p className="font-mono text-caption tnum text-slate">404</p>
      <h1 className="mt-2 font-display text-display text-ink">That page is not here</h1>
      <p className="mt-3 text-small text-slate">
        The link may be out of date, or the profile may have been withdrawn.
      </p>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link
          to="/search"
          className="inline-flex min-h-tap-lg items-center justify-center rounded-control bg-ink px-5 text-small font-medium text-white hover:bg-ink-deep"
        >
          Find a tutor
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-tap items-center justify-center rounded-control border border-slate-line px-5 text-small font-medium text-ink hover:bg-paper"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
