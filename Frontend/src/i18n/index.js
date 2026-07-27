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
 * ── Why the resources are bundled rather than fetched ──────────────────────
 * `i18next-http-backend` would fetch each namespace on demand. On a patchy
 * connection that means a screen renders with raw keys visible until the
 * request lands — and the screens most likely to be opened on a bad connection
 * are the ones a parent needs most. Sixteen small JSON files compress to a few
 * kilobytes; they ship with the bundle.
 *
 * ── Numerals stay Western-Arabic in both views ─────────────────────────────
 * FR-27.6. `formatNumber` in `src/lib/format.js` pins the numbering system, so
 * a rate does not change digits between languages. An amount somebody misreads
 * because the digits changed shape is worse than an untranslated label.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from '../locales/en/common.json';
import enAuth from '../locales/en/auth.json';
import enSearch from '../locales/en/search.json';
import enAi from '../locales/en/ai.json';
import enBooking from '../locales/en/booking.json';
import enPayments from '../locales/en/payments.json';
import enTutor from '../locales/en/tutor.json';
import enAdmin from '../locales/en/admin.json';
import enFeedback from '../locales/en/feedback.json';
import enVolunteer from '../locales/en/volunteer.json';
import enHomeTuition from '../locales/en/homeTuition.json';
import enProgress from '../locales/en/progress.json';
import enDemand from '../locales/en/demand.json';
import enGroups from '../locales/en/groups.json';
import enOrganisation from '../locales/en/organisation.json';

import urCommon from '../locales/ur/common.json';
import urAuth from '../locales/ur/auth.json';
import urSearch from '../locales/ur/search.json';
import urAi from '../locales/ur/ai.json';
import urBooking from '../locales/ur/booking.json';
import urPayments from '../locales/ur/payments.json';
import urTutor from '../locales/ur/tutor.json';
import urAdmin from '../locales/ur/admin.json';
import urFeedback from '../locales/ur/feedback.json';
import urVolunteer from '../locales/ur/volunteer.json';
import urHomeTuition from '../locales/ur/homeTuition.json';
import urProgress from '../locales/ur/progress.json';
import urDemand from '../locales/ur/demand.json';
import urGroups from '../locales/ur/groups.json';
import urOrganisation from '../locales/ur/organisation.json';

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

const initial = detectLanguage();

i18next.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      auth: enAuth,
      search: enSearch,
      ai: enAi,
      booking: enBooking,
      payments: enPayments,
      tutor: enTutor,
      admin: enAdmin,
      feedback: enFeedback,
      volunteer: enVolunteer,
      homeTuition: enHomeTuition,
      progress: enProgress,
      demand: enDemand,
      groups: enGroups,
      organisation: enOrganisation,
    },
    ur: {
      common: urCommon,
      auth: urAuth,
      search: urSearch,
      ai: urAi,
      booking: urBooking,
      payments: urPayments,
      tutor: urTutor,
      admin: urAdmin,
      feedback: urFeedback,
      volunteer: urVolunteer,
      homeTuition: urHomeTuition,
      progress: urProgress,
      demand: urDemand,
      groups: urGroups,
      organisation: urOrganisation,
    },
  },
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
