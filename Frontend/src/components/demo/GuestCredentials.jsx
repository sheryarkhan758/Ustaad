/**
 * Guest credentials for the five roles — §6.15, FR-15.9.
 *
 * ── Why this is behind a flag ──────────────────────────────────────────────
 * A published password is safe on a demonstration and unsafe on anything else.
 * `VITE_DEMO_MODE` decides, and it is read at build time: a deployment that did
 * not set it does not merely hide this panel, it does not contain the strings
 * at all, because the whole component is tree-shaken away by the constant.
 *
 * The password itself is **not** compiled in. It is whatever the operator
 * seeded with (`DEMO_SEED_PASSWORD`), supplied through `VITE_DEMO_PASSWORD`, so
 * this file names accounts and never a secret. On a database seeded with the
 * README's published password that variable simply repeats what the README
 * already says; on a live database it says whatever the operator chose, and the
 * repository never learns it.
 *
 * ── Why it is on the landing page ──────────────────────────────────────────
 * §14.6: a stranger reaches meaningful output in ninety seconds. Ninety seconds
 * does not survive hunting for credentials in a README on a different site.
 */

import { useTranslation } from 'react-i18next';

/** Build-time constants, so an unset flag removes this from the bundle. */
const DEMO_MODE = import.meta.env?.VITE_DEMO_MODE === 'true';
const DEMO_PASSWORD = import.meta.env?.VITE_DEMO_PASSWORD ?? '';

/** The five roles §5.1 names, in the order the demonstration path uses them. */
const ACCOUNTS = [
  { role: 'parent', email: 'parent@demo.ustaad.test' },
  { role: 'tutor', email: 'ayesha-siddiqui@demo.ustaad.test' },
  { role: 'student', email: 'student@demo.ustaad.test' },
  { role: 'organisation', email: 'academy@demo.ustaad.test' },
  { role: 'admin', email: 'admin@demo.ustaad.test' },
];

export function GuestCredentials() {
  const { t } = useTranslation('common');

  if (!DEMO_MODE) return null;

  return (
    <section
      aria-labelledby="guest-credentials-heading"
      className="rounded-card border border-slate-line bg-white p-4"
    >
      <h2 id="guest-credentials-heading" className="font-display text-subtitle text-ink">
        {t('demo.credentialsHeading')}
      </h2>
      <p className="mt-1 text-small text-slate">{t('demo.credentialsBody')}</p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">{t('demo.credentialsHeading')}</caption>
          <thead>
            <tr className="border-b border-slate-line">
              <th scope="col" className="py-1.5 pe-3 text-start text-caption uppercase text-slate">
                {t('demo.role')}
              </th>
              <th scope="col" className="py-1.5 text-start text-caption uppercase text-slate">
                {t('demo.email')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ACCOUNTS.map((account) => (
              <tr key={account.role} className="border-b border-slate-line last:border-0">
                <th scope="row" className="py-1.5 pe-3 text-start font-medium text-ink">
                  {t(`role.${account.role}`, { defaultValue: account.role })}
                </th>
                <td className="py-1.5">
                  {/* `dir="ltr"` on an address in the Urdu view: an email read
                      right-to-left is an email nobody can type back in. */}
                  <code dir="ltr" className="font-mono text-caption text-ink">
                    {account.email}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {DEMO_PASSWORD ? (
        <p className="mt-3 text-small text-ink">
          {t('demo.password')}:{' '}
          <code dir="ltr" className="font-mono text-caption">
            {DEMO_PASSWORD}
          </code>
        </p>
      ) : (
        <p className="mt-3 text-caption text-slate">{t('demo.passwordUnset')}</p>
      )}

      <p className="mt-2 text-caption text-slate">{t('demo.credentialsNote')}</p>
    </section>
  );
}
