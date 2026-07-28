/**
 * Internationalisation — §6.27.
 *
 * Two locales, English and Urdu, and a hard boundary between them and the
 * user's own words.
 *
 * ── The boundary this file exists to enforce ───────────────────────────────
 * **Only interface strings pass through i18next.** Reviews, biographies,
 * session notes, feedback and volunteer motivations are rendered verbatim by
 * `<UserText>` and never touch a translation function (decision 13, FR-27.5).
 *
 * Translating a reviewer's words would misrepresent them: a parent who wrote
 * *"waqt par aati hain"* did not write *"she arrives on time"*, and a platform
 * that silently rewrites what people said about each other has replaced
 * testimony with paraphrase. `src/i18n/ugc.test.js` fails the build if a
 * user-content field is passed to `t()`.
 *
 * ── One language at a time, and never a raw key ────────────────────────────
 * `i18next-http-backend` would fetch each namespace on demand. On a patchy
 * connection that means a screen renders with raw keys visible until the
 * request lands — and the screens most likely to be opened on a bad connection
 * are the ones a parent needs most. So namespaces are never fetched per screen.
 *
 * But shipping **both** dictionaries to everybody was costing every reader the
 * language they do not read: 112 kB of English and 140 kB of Urdu in the first
 * load, on a connection where that is the difference between a usable first
 * paint and a blank one.
 *
 * So a language is one chunk, loaded whole, and the reader's own language is
 * awaited before the first render (`main.jsx`). Raw keys still never appear —
 * the dictionary is complete before anything paints — and the other language
 * arrives only if somebody actually uses the toggle.
 *
 * ── Numerals stay Western-Arabic in both views ─────────────────────────────
 * FR-27.6. `formatNumber` in `src/lib/format.js` pins the numbering system, so
 * a rate does not change digits between languages. An amount somebody misreads
 * because the digits changed shape is worse than an untranslated label.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';



export const LOCALES = {
  en: { label: 'English', nativeLabel: 'English', dir: 'ltr' },
  /** `اردو` in its own script — a language switch labelled in the language you
   *  are leaving is no use to someone who cannot read that language. */
  ur: { label: 'Urdu', nativeLabel: 'اردو', dir: 'rtl' },
};

export const NAMESPACES = [
  'common',
  'auth',
  'search',
  'ai',
  'booking',
  'payments',
  'tutor',
  'admin',
  'feedback',
  'volunteer',
  'homeTuition',
  'groups',
  'demand',
  'progress',
  'organisation',
];

const STORAGE_KEY = 'ustaad.lang';

/**
 * The stored preference, or the browser's, or English.
 *
 * A guest's choice persists in localStorage; a signed-in user's preference
 * lives on their account (`users.preferred_lang`) and is applied on login
 * (FR-27.2). Reading storage is wrapped because private mode and a full quota
 * both throw, and a language preference is not worth a blank page.
 */
export function detectLanguage() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && stored in LOCALES) return stored;
  } catch {
    /* storage unavailable — fall through to the browser's own preference */
  }

  const browser = globalThis.navigator?.language?.slice(0, 2);
  return browser && browser in LOCALES ? browser : 'en';
}

export function persistLanguage(lng) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lng);
  } catch {
    /* the choice still applies for this session */
  }
}

/**
 * Put the language and direction on `<html>`.
 *
 * Both matter, and for different reasons. `dir` flips the layout; `lang` tells
 * the browser which font stack and hyphenation rules to use, and tells a screen
 * reader which voice to read in. A page with `dir="rtl"` and `lang="en"` is
 * read aloud in English by an Urdu layout, which helps nobody.
 */
export function applyDocumentLanguage(lng) {
  const locale = LOCALES[lng] ?? LOCALES.en;
  const root = globalThis.document?.documentElement;
  if (!root) return;

  root.setAttribute('lang', lng);
  root.setAttribute('dir', locale.dir);
}

/**
 * Every namespace of one language, as a single chunk.
 *
 * `import.meta.glob` rather than fifteen dynamic imports: Vite collects the
 * matching files at build time, so a language is one network request instead of
 * fifteen, and adding a namespace needs no change here.
 */
const DICTIONARIES = import.meta.glob('../locales/*/*.json');

/**
 * Load one language and register it.
 *
 * Idempotent: i18next holds the bundles, so a second call for a language
 * already present is a no-op and the toggle can be used freely.
 */
export async function loadLanguage(lng) {
  if (i18next.hasResourceBundle(lng, 'common')) return;

  const entries = Object.entries(DICTIONARIES).filter(([path]) =>
    path.includes(`/locales/${lng}/`),
  );

  await Promise.all(
    entries.map(async ([path, load]) => {
      const namespace = path.split('/').pop().replace('.json', '');
      const module = await load();
      // `deep` and `overwrite` false: a namespace is loaded once, whole.
      i18next.addResourceBundle(lng, namespace, module.default, false, false);
    }),
  );
}

const initial = detectLanguage();

i18next.use(initReactI18next).init({
  // Filled by `loadLanguage` before the first render — see above.
  resources: {},
  lng: initial,
  fallbackLng: 'en',
  ns: NAMESPACES,
  defaultNS: 'common',

  interpolation: {
    // React escapes for us. Double-escaping turns an apostrophe in a tutor's
    // name into `&#39;` on screen.
    escapeValue: false,
  },

  returnEmptyString: false,

  // A missing key should be loud in development and invisible in production:
  // a parent should never see `search.filters.gender` where a label belongs.
  saveMissing: false,
  missingKeyHandler: import.meta.env?.DEV
    ? (lngs, ns, key) => {
        console.warn(`[i18n] missing key "${ns}:${key}" for ${lngs.join(', ')}`);
      }
    : undefined,

  react: {
    useSuspense: false,
  },
});

applyDocumentLanguage(initial);

export default i18next;
