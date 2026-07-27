/**
 * Forgot password — **a placeholder, and it says so.**
 *
 * ── Why it is not built ────────────────────────────────────────────────────
 * A password reset needs a mail channel that can be trusted to deliver, and the
 * only one this project has is EmailJS — a free-tier notification channel with
 * a monthly quota, deliberately treated as *never a system of record* (§2.13).
 * A reset link that silently fails to arrive locks somebody out of an account
 * holding their child's records, with no way to tell whether the mail was sent.
 *
 * So rather than a form that appears to work, this screen states the position
 * and gives the route that does work today. An interface that pretends to have
 * a capability it lacks is worse than one that admits the gap: the person who
 * trusts the pretend version is the one who ends up locked out.
 *
 * When it is built, it needs: a single-use token with a short expiry, stored as
 * a hash, invalidating every outstanding session on use — the same treatment
 * the refresh-token family already gets.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Card, CardBody } from '../../components/ui/Card';
import { Warning } from '../../components/ui/Icon';

export default function ForgotPassword() {
  const { t } = useTranslation(['auth', 'common']);

  return (
    <div className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-display text-display text-ink">{t('forgot.title')}</h1>

      <Card className="mt-6">
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <Warning className="mt-0.5 text-seal-deep" />
            <div>
              <p className="text-small font-semibold text-ink">{t('forgot.notBuiltTitle')}</p>
              <p className="mt-1 text-small text-slate">{t('forgot.notBuiltBody')}</p>
            </div>
          </div>

          <div className="rounded-card border border-slate-line bg-paper p-4">
            <p className="text-small font-medium text-ink">{t('forgot.whatToDoTitle')}</p>
            <p className="mt-1 text-small text-slate">{t('forgot.whatToDoBody')}</p>
          </div>

          <Link
            to="/login"
            className="inline-flex min-h-tap items-center rounded-control border border-slate-line px-4 text-small font-medium text-ink hover:bg-paper"
          >
            {t('signIn.title')}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
