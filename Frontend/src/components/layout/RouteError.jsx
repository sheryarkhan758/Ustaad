/**
 * What a person sees when a screen fails — NFR-11.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Without an `errorElement`, React Router renders its own developer screen: a
 * stack trace, a line number, and a cheerful note addressed to the developer.
 * That is the correct default for a developer and the wrong thing entirely for
 * a parent, who learns from it that the site is broken and that nobody
 * expected them to be there.
 *
 * A thrown render error is rare. The one that matters here is not: when the
 * API is unreachable, every data query on a page fails at once, and a screen
 * that reacts by disappearing is indistinguishable from a screen that never
 * existed.
 *
 * ── It names the likely cause, not the exception ──────────────────────────
 * A 502 from every endpoint means the server is not answering — almost always
 * a deployment without a database behind it. Saying that is more useful than
 * `TypeError: Cannot read properties of undefined`, and it is the difference
 * between somebody reporting "the site is down" and somebody reporting
 * something actionable.
 *
 * ── It always offers a way onward ─────────────────────────────────────────
 * Reload, and a link home. A dead end with no action is how a person decides
 * to leave rather than to try again.
 */

import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Card, CardBody } from '../ui/Card';
import { Warning } from '../ui/Icon';

export function RouteError() {
  const { t } = useTranslation(['common']);
  const error = useRouteError();

  /*
   * A network failure and a 5xx both mean "the server is not answering". The
   * API layer turns an unreachable host into `network_unavailable`, so these
   * two cover the whole of "it is not us, it is the backend".
   */
  const backendDown =
    error?.status >= 500 || error?.code === 'network_unavailable' || error?.status === 0;

  return (
    <div className="mx-auto max-w-prose px-4 py-12">
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <Warning className="mt-1 shrink-0 text-seal-deep" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="font-display text-title text-ink">
                {t(backendDown ? 'routeError.backendTitle' : 'routeError.title')}
              </h1>
              <p className="mt-1 text-body text-slate">
                {t(backendDown ? 'routeError.backendBody' : 'routeError.body')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => globalThis.location?.reload()}>
              {t('action.retry')}
            </Button>
            <Button as={Link} to="/" variant="secondary">
              {t('routeError.home')}
            </Button>
          </div>

          {/*
            The technical detail, available but not shouted. Somebody reporting
            a fault needs it; somebody who just wants a tutor does not.
          */}
          {error?.message ? (
            <details className="text-caption text-slate">
              <summary className="min-h-tap cursor-pointer">{t('routeError.details')}</summary>
              <p className="mt-1 break-words font-mono">{error.message}</p>
            </details>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
