/**
 * **User-generated content is NEVER machine-translated** — decision 13, FR-27.5.
 *
 * This is the test that makes the rule enforceable rather than aspirational.
 *
 * A parent who wrote *"waqt par aati hain, lekin pace thora tez hai"* did not
 * write *"she arrives on time, but the pace is a little fast"*. A platform that
 * silently rewrites what people said about each other has replaced testimony
 * with paraphrase — and on a product whose entire claim is that its records are
 * trustworthy, that is the most expensive possible thing to get wrong.
 *
 * The rule has two halves and both are checked:
 *
 *  1. **Behavioural** — `<UserText>` renders its input byte-for-byte, in either
 *     language mode, in any script or mixture of scripts.
 *  2. **Structural** — no source file passes a user-content field through a
 *     translation function. This is the half that catches the mistake before it
 *     ships, because the behavioural half only tests the component somebody
 *     remembered to use.
 */

import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import i18n from './index';
import { UserQuote, UserText } from '../components/ui/UserText';

/** Real text of the kind this platform actually receives. */
const SAMPLES = {
  romanUrdu:
    'Ayesha baji waqt par aati hain aur mere bete ko samajh aa raha hai. Sirf pace thora tez hai.',
  urduScript: 'استاد صاحبہ وقت پر آتی ہیں اور بچے کو اچھی طرح سمجھاتی ہیں۔',
  english: 'She started by testing my daughter on things from class six, which I did not expect.',
  /** The realistic case: three scripts in one sentence. */
  mixed: 'Bohat achi teacher hain — ریاضی میں bohat improvement hui hai. 5/5.',
  withMarkup: 'Rate is <b>18,000</b> & the timing is 4-6pm.',
};

function renderIn(lng, ui) {
  i18n.changeLanguage(lng);
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe('user-generated content is never translated', () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    it(`renders ${name} unchanged in English mode`, () => {
      renderIn('en', <UserText>{text}</UserText>);
      expect(screen.getByText(text).textContent).toBe(text);
    });

    it(`renders ${name} unchanged in Urdu mode`, () => {
      renderIn('ur', <UserText>{text}</UserText>);
      // The page is right-to-left; the review still says exactly what it said.
      expect(screen.getByText(text).textContent).toBe(text);
    });
  }

  it('renders identically in both language modes', () => {
    const { container: en, unmount } = renderIn('en', <UserText>{SAMPLES.mixed}</UserText>);
    const enText = en.textContent;
    unmount();

    const { container: ur } = renderIn('ur', <UserText>{SAMPLES.mixed}</UserText>);
    expect(ur.textContent).toBe(enText);
  });

  it('leaves direction to the browser rather than forcing it', () => {
    // `dir="auto"` is the whole mechanism: an Urdu review inside an English
    // page must still read right-to-left, and Roman Urdu — which has no strong
    // RTL character — must correctly read left-to-right.
    renderIn('en', <UserText>{SAMPLES.urduScript}</UserText>);
    expect(screen.getByText(SAMPLES.urduScript).getAttribute('dir')).toBe('auto');
  });

  it('escapes markup rather than rendering it', () => {
    // This component renders text typed by strangers. There is deliberately no
    // dangerouslySetInnerHTML path in it, and there must never be one.
    renderIn('en', <UserText>{SAMPLES.withMarkup}</UserText>);
    const node = screen.getByText(SAMPLES.withMarkup);
    expect(node.innerHTML).not.toContain('<b>');
    expect(node.textContent).toBe(SAMPLES.withMarkup);
  });

  it('renders a quotation verbatim, with the citation kept separate', () => {
    const { container } = renderIn('ur', <UserQuote cite="A parent">{SAMPLES.romanUrdu}</UserQuote>);
    const quote = container.querySelector('blockquote');

    // The reviewer's words are their own text node. Asserting on the
    // blockquote's full `textContent` would fold in the citation — and the
    // point of the citation being a separate `<cite>` is that it is the
    // platform's attribution, not part of what the reviewer wrote.
    expect(quote.firstChild.textContent).toBe(SAMPLES.romanUrdu);
    expect(quote.querySelector('cite').textContent).toBe('A parent');
  });

  it('renders nothing at all for empty content, rather than a stray element', () => {
    const { container } = renderIn('en', <UserText>{''}</UserText>);
    expect(container.firstChild).toBeNull();
  });
});

/* =========================================================================
 * Structural — the half that catches the mistake before it ships
 * ====================================================================== */

/** Fields that carry a person's own words. Never translated, ever. */
const USER_CONTENT_FIELDS = [
  'bio',
  'bioUr',
  'biography',
  'reviewText',
  'motivation',
  'detail',
  'note',
  'sessionNote',
  'resolutionNote',
  'tutorReason',
  'decisionReason',
  'qualifications',
];

function sourceFiles(dir = 'src') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('no source file translates user content', () => {
  it('never passes a user-content field to t()', () => {
    const offenders = [];

    for (const file of sourceFiles()) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));

      for (const field of USER_CONTENT_FIELDS) {
        // `t(review.text)`, `t(tutor.bio)`, `t(application.motivation)` — any
        // shape where a user-content field is the key.
        const pattern = new RegExp(`\\bt\\(\\s*[\\w.]*\\b${field}\\b`, 'i');
        if (pattern.test(code)) offenders.push(`${file}: t(…${field}…)`);
      }
    }

    expect(
      offenders,
      `These pass user-generated content through a translation function. ` +
        `Reviews, biographies and motivations render verbatim through <UserText> ` +
        `(decision 13, FR-27.5):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('renders user-content fields only through UserText', () => {
    // The real invariant, and the one worth checking structurally: a review or
    // a biography interpolated directly into JSX is a field that will one day
    // be wrapped in something that transforms it. `<UserText>` is the only
    // component permitted to render one, and it renders verbatim by
    // construction.
    const offenders = [];

    for (const file of sourceFiles()) {
      if (file.includes('UserText')) continue; // the component itself
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      /*
       * A form's error bag is keyed by field name, so `{form.errors.note}` is
       * indistinguishable by shape from a rendered note — and is a **Zod
       * validation message**, authored text from the shared schema rather than
       * anything a user wrote. Removing those accessors before matching is
       * clearer than a second regex trying to exclude them, and it keeps the
       * check from pushing somebody to wrap a validation message in
       * `<UserText>` to silence it.
       */
      const readable = code.replace(/\berrors\.\w+/g, 'errorMessage');

      for (const field of USER_CONTENT_FIELDS) {
        // `{review.text}` or `{tutor.bio}` as a bare JSX child.
        const bare = new RegExp(String.raw`\{\s*[\w?.]+\.${field}\s*\}`);
        if (!bare.test(readable)) continue;

        // Permitted when it is the child of a UserText or UserQuote element.
        const wrapped = new RegExp(
          String.raw`<User(?:Text|Quote)[^>]*>\s*\{\s*[\w?.]+\.${field}\s*\}`,
        );
        if (!wrapped.test(readable)) offenders.push(`${file}: {…${field}} rendered outside <UserText>`);
      }
    }

    expect(
      offenders,
      'User-generated content must render through <UserText>, which renders it ' +
        'verbatim and lets the browser decide direction (decision 13, FR-27.5):\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });
});
