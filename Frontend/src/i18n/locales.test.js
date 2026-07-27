/**
 * The locale files themselves.
 *
 * FR-27.1 requires every interface string to come from the dictionary, which is
 * only true if the dictionary is complete. A missing Urdu key does not throw —
 * i18next silently falls back to English — so an Urdu page quietly renders half
 * in English and nobody notices until a marker opens it.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOCALES, NAMESPACES } from './index';

const LOCALE_DIR = path.join('src', 'locales');

function load(lng, ns) {
  return JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, lng, `${ns}.json`), 'utf8'));
}

function flatten(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const here = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null ? flatten(value, here) : [here];
  });
}

describe('locale files', () => {
  it('has every namespace in every locale', () => {
    for (const lng of Object.keys(LOCALES)) {
      for (const ns of NAMESPACES) {
        const file = path.join(LOCALE_DIR, lng, `${ns}.json`);
        expect(fs.existsSync(file), `${file} is missing`).toBe(true);
      }
    }
  });

  it('has identical key structure in English and Urdu', () => {
    const missing = [];

    for (const ns of NAMESPACES) {
      const en = new Set(flatten(load('en', ns)));
      const ur = new Set(flatten(load('ur', ns)));

      for (const key of en) if (!ur.has(key)) missing.push(`ur is missing ${ns}:${key}`);
      for (const key of ur) if (!en.has(key)) missing.push(`en is missing ${ns}:${key}`);
    }

    expect(
      missing,
      `A missing key falls back to English silently, so an Urdu page renders ` +
        `half-translated with no error:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no empty string, which renders as a blank label', () => {
    const empty = [];

    for (const lng of Object.keys(LOCALES)) {
      for (const ns of NAMESPACES) {
        const json = load(lng, ns);
        const walk = (node, prefix) => {
          for (const [key, value] of Object.entries(node)) {
            const here = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null) walk(value, here);
            else if (typeof value === 'string' && value.trim() === '') empty.push(`${lng}/${ns}:${here}`);
          }
        };
        walk(json, '');
      }
    }

    expect(empty).toEqual([]);
  });

  it('keeps interpolation placeholders identical across locales', () => {
    // `{{count}}` present in English and absent in Urdu produces a sentence
    // with the number missing — and the numbers here are rates and dates.
    const mismatched = [];
    const placeholders = (text) => (text.match(/\{\{(\w+)\}\}/g) ?? []).sort().join(',');

    for (const ns of NAMESPACES) {
      const en = load('en', ns);
      const ur = load('ur', ns);

      const walk = (a, b, prefix) => {
        for (const [key, value] of Object.entries(a)) {
          const here = prefix ? `${prefix}.${key}` : key;
          const other = b?.[key];
          if (typeof value === 'object' && value !== null) {
            walk(value, other ?? {}, here);
          } else if (typeof value === 'string' && typeof other === 'string') {
            if (placeholders(value) !== placeholders(other)) {
              mismatched.push(`${ns}:${here} — en has [${placeholders(value)}], ur has [${placeholders(other)}]`);
            }
          }
        }
      };

      walk(en, ur, '');
    }

    expect(mismatched).toEqual([]);
  });

  it('never uses a prohibited verification word in either locale', () => {
    // §2.5 / SEC-6. Badge wording must state the artefact checked and never
    // imply a check that was not performed — in every language.
    const prohibited = [
      ['trusted', /\btrusted\b/i],
      ['vetted', /\bvetted\b/i],
      ['screened', /\bscreened\b/i],
      ['background checked', /\bbackground[- ]checked\b/i],
      ['police verified', /\bpolice[- ]verified\b/i],
      ['certified safe', /\bcertified safe\b/i],
    ];

    const offenders = [];

    for (const lng of Object.keys(LOCALES)) {
      for (const ns of NAMESPACES) {
        const json = JSON.stringify(load(lng, ns));
        for (const [word, pattern] of prohibited) {
          // "No police or background check is performed" is the required
          // disclosure, not a claim — it is allowed and nothing else is.
          const withoutDisclosure = json
            .replace(/No police or background check is performed\./gi, '')
            .replace(/پولیس یا بیک گراؤنڈ چیک نہیں کیا جاتا۔/g, '');
          if (pattern.test(withoutDisclosure)) offenders.push(`${lng}/${ns}: "${word}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
