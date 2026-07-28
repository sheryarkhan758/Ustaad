/**
 * The language toggle — FR-27.2.
 *
 * ── Labelled in the language you are switching *to* ────────────────────────
 * The control reads `اردو` in the English view and `English` in the Urdu view.
 * A switch labelled in the language you are leaving is no use to somebody who
 * cannot read that language — which is precisely the person the switch exists
 * for.
 *
 * ── Two persistence layers, on purpose ─────────────────────────────────────
 * A guest's choice goes to localStorage; a signed-in user's belongs on their
 * account so it follows them to another device. This writes the local one and
 * the account write lands with the settings screen. Both are needed: a parent
 * who sets Urdu on a shared family phone should not have it follow them to a
 * different account on the same device.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { LOCALES, applyDocumentLanguage, loadLanguage, persistLanguage } from '../../i18n';

export function LanguageToggle({ className = '' }) {
  const { t, i18n } = useTranslation('common');
  const current = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const next = current === 'ur' ? 'en' : 'ur';
  const nextLocale = LOCALES[next];

  const switchTo = useCallback(async () => {
    /*
     * The other dictionary, fetched the first time somebody asks for it.
     *
     * Awaited **before** the switch, not after: changing the language with the
     * bundle missing would repaint every string as its own key for as long as
     * the request took. Loaded once and then held by i18next, so a reader who
     * flips back and forth pays for it once.
     */
    await loadLanguage(next);
    await i18n.changeLanguage(next);
    persistLanguage(next);
    // `lang` and `dir` on <html> — the layout flip and the font stack both
    // hang off these, as does which voice a screen reader uses.
    applyDocumentLanguage(next);
  }, [i18n, next]);

  return (
    <button
      type="button"
      onClick={switchTo}
      // The accessible name says what will happen, in the current language.
      aria-label={t('language.switchTo', { language: nextLocale.label })}
      className={[
        'min-h-tap rounded-control px-3 text-small font-medium text-white/85',
        'hover:bg-white/10 hover:text-white',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        `lang` on the label itself so the browser picks the right font for the
        target language — the Urdu label must render in Naskh even while the
        surrounding page is English.
      */}
      <span lang={next} aria-hidden="true" className={next === 'ur' ? 'font-urdu' : undefined}>
        {nextLocale.nativeLabel}
      </span>
    </button>
  );
}
