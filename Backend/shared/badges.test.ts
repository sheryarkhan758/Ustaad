/**
 * The badge guard — FR-6.8, SEC-6, §4.2.
 *
 * Ustaad.com performs no police check, no background check and no
 * criminal-record clearance, and none is obtainable by this project. A badge
 * implying otherwise is not a copy mistake: a family reads "Trusted" on a
 * profile, concludes the platform knows something it does not know, and lets
 * that person into a house with a child in it.
 *
 * So the assertion here is not "the templates are worded correctly today". It
 * is **"no input produces forbidden wording"**, which is a different and much
 * stronger claim, and it is tested adversarially.
 */

import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_BADGE_TERMS,
  VERIFICATION_SCOPE_NOTE,
  assertBadgeTextPermitted,
  buildBadges,
  findForbiddenTerm,
  isBadgeTextPermitted,
} from './badges';

/* =========================================================================
 * The correct badges
 * ====================================================================== */

describe('badge text says exactly what was checked', () => {
  it('emits one badge per artefact actually checked', () => {
    const { badges } = buildBadges({ artefactsChecked: ['cnic', 'degree'] });

    expect(badges.map((b) => b.text)).toEqual([
      'CNIC verified by Ustaad.com',
      'Academic documents reviewed',
    ]);
    expect(badges.every((b) => b.track === 'identity')).toBe(true);
  });

  it('emits nothing for an artefact that was not checked', () => {
    const { badges } = buildBadges({ artefactsChecked: ['cnic'] });

    expect(badges).toHaveLength(1);
    expect(badges[0]!.text).toBe('CNIC verified by Ustaad.com');
    // No degree was looked at, so nothing claims one was.
    expect(JSON.stringify(badges)).not.toMatch(/academic/i);
  });

  it('emits no badge at all when nothing was checked', () => {
    expect(buildBadges({ artefactsChecked: [] }).badges).toEqual([]);
  });

  it('keeps the identity and competency tracks separate (FR-6.2)', () => {
    const { badges } = buildBadges({
      artefactsChecked: ['cnic'],
      verifiedTopics: [{ name: 'Organic Chemistry', expiresOn: '2027-07-26' }],
    });

    expect(badges.filter((b) => b.track === 'identity')).toHaveLength(1);
    expect(badges.filter((b) => b.track === 'competency')).toHaveLength(1);
    // Never merged into one "verified tutor" badge.
    expect(badges.find((b) => b.track === 'competency')!.text).toBe(
      'Passed assessment: Organic Chemistry',
    );
  });

  it('carries the expiry date on a competency badge (FR-28.1)', () => {
    const { badges } = buildBadges({
      artefactsChecked: [],
      verifiedTopics: [{ name: 'Quadratic Equations', expiresOn: '2027-07-26' }],
    });

    expect(badges[0]!.expiresOn).toBe('2027-07-26');
  });

  it('always ships the scope note, in both languages', () => {
    const { scopeNote } = buildBadges({ artefactsChecked: ['cnic'] });

    expect(scopeNote.en).toMatch(/no police check/i);
    expect(scopeNote.ur).toContain('پولیس');
    // The note itself must survive the guard.
    expect(isBadgeTextPermitted(VERIFICATION_SCOPE_NOTE.en.replace(/no police check[^.]*\./i, ''))).toBe(
      true,
    );
  });
});

/* =========================================================================
 * The prohibition — for any input
 * ====================================================================== */

describe('no input produces forbidden wording', () => {
  it('catches every listed term on its own', () => {
    for (const term of FORBIDDEN_BADGE_TERMS) {
      expect(isBadgeTextPermitted(term), term).toBe(false);
      expect(isBadgeTextPermitted(`Ustaad.com — ${term} tutor`), term).toBe(false);
    }
  });

  it('catches them however they are spelled', () => {
    const evasions = [
      'Background Checked',
      'BACKGROUND CHECKED',
      'background-checked',
      'background_checked',
      'background   checked',
      'backgroundchecked',
      'Back-Ground Checked',
      'Police Verified',
      'police.verified',
      'POLICE_VERIFIED',
      'policeverified',
      'Vetted by Ustaad.com',
      'Certified Safe',
      'certifiedsafe',
      'Fully Verified',
      'DBS',
      'dbs checked',
      'criminal-record clearance',
    ];

    for (const text of evasions) {
      expect(isBadgeTextPermitted(text), text).toBe(false);
      expect(findForbiddenTerm(text), text).not.toBeNull();
    }
  });

  it('OMITS a competency badge whose topic name contains forbidden wording', () => {
    // The adversarial case: a topic named to smuggle a claim into the one
    // template with a variable part.
    const { badges, rejected } = buildBadges({
      artefactsChecked: ['cnic'],
      verifiedTopics: [
        { name: 'Organic Chemistry' },
        { name: 'Police Verified Physics' },
        { name: 'Background Checked Biology' },
        { name: 'Safe Tutoring' },
      ],
    });

    const texts = badges.map((b) => b.text).join(' | ');
    expect(texts).toContain('Organic Chemistry');
    expect(texts).not.toMatch(/police/i);
    expect(texts).not.toMatch(/background/i);
    expect(rejected).toHaveLength(3);

    // Omitted, never softened into something vaguer. A vague badge is still a
    // badge, and a family reads more into one than it says.
    expect(badges).toHaveLength(2);
  });

  it('rejects a topic name carrying markup or control characters', () => {
    const { badges, rejected } = buildBadges({
      artefactsChecked: [],
      verifiedTopics: [
        { name: '<script>alert(1)</script>' },
        { name: 'Physics\nPolice Verified' },
        { name: '   ' },
        { name: 'x'.repeat(200) },
      ],
    });

    expect(badges).toEqual([]);
    expect(rejected).toHaveLength(4);
  });

  it('never emits a forbidden phrase for ANY generated combination', () => {
    // Exhaustive over the artefact power set, crossed with adversarial topic
    // names built from every forbidden term.
    const artefactSets: string[][] = [
      [],
      ['cnic'],
      ['degree'],
      ['transcript'],
      ['cnic', 'degree'],
      ['cnic', 'transcript'],
      ['degree', 'transcript'],
      ['cnic', 'degree', 'transcript'],
      // Unknown artefacts must simply be ignored.
      ['police_check', 'background_check', 'nonsense'],
    ];

    const topicNames = [
      'Organic Chemistry',
      ...FORBIDDEN_BADGE_TERMS,
      ...FORBIDDEN_BADGE_TERMS.map((t) => t.toUpperCase()),
      ...FORBIDDEN_BADGE_TERMS.map((t) => `${t} Mathematics`),
      ...FORBIDDEN_BADGE_TERMS.map((t) => t.replace(/ /g, '-')),
      ...FORBIDDEN_BADGE_TERMS.map((t) => t.replace(/ /g, '')),
    ];

    let combinations = 0;

    for (const artefacts of artefactSets) {
      for (const name of topicNames) {
        const result = buildBadges({
          artefactsChecked: artefacts,
          verifiedTopics: [{ name }],
        });
        combinations += 1;

        for (const badge of result.badges) {
          for (const text of [badge.text, badge.textUr]) {
            expect(findForbiddenTerm(text), `"${text}" from topic "${name}"`).toBeNull();
            // And the strict variant agrees.
            expect(() => assertBadgeTextPermitted(text)).not.toThrow();
          }
        }
      }
    }

    // Guard against a vacuous pass: the loop must actually have run.
    expect(combinations).toBeGreaterThan(1000);
  });

  it('never throws, whatever it is handed', () => {
    const hostile: unknown[] = [
      { artefactsChecked: [] },
      { artefactsChecked: ['cnic'], verifiedTopics: [] },
      { artefactsChecked: ['', ' ', 'CNIC'], verifiedTopics: [{ name: '' }] },
      { artefactsChecked: ['cnic'], verifiedTopics: [{ name: 'Trusted', expiresOn: 'nonsense' }] },
    ];

    for (const input of hostile) {
      expect(() => buildBadges(input as Parameters<typeof buildBadges>[0])).not.toThrow();
    }
  });
});

describe('the strict variant', () => {
  it('throws and names the offending term', () => {
    expect(() => assertBadgeTextPermitted('Trusted tutor')).toThrow(/prohibited term "trusted"/i);
    expect(() => assertBadgeTextPermitted('CNIC verified by Ustaad.com')).not.toThrow();
  });

  it('explains why, so the next person does not re-add it', () => {
    expect(() => assertBadgeTextPermitted('Background checked')).toThrow(
      /no police check, background check or criminal-record clearance/i,
    );
  });
});
