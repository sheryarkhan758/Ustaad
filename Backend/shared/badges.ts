/**
 * Verification badge text — FR-6.5, FR-6.8, FR-6.9, SEC-6, §4.2.
 *
 * This is the smallest file in the project and among the most load-bearing.
 * Ustaad.com performs **no police check, no background check and no
 * criminal-record clearance**, and none is obtainable by this project (§4.2).
 * Every badge must therefore say exactly what was checked and imply nothing
 * further — because a family reading "Trusted" on a profile will conclude the
 * platform knows something about this person that it does not know, and will
 * let them into a house with a child in it on that basis.
 *
 * ── How the constraint is enforced ─────────────────────────────────────────
 * Three layers, because one is not enough:
 *
 *  1. **A closed template set.** Badge text is chosen from a fixed list of
 *     authored strings. There is no code path that emits free text.
 *  2. **Validated interpolation.** The one template with a variable part —
 *     `Passed assessment: <topic>` — validates the topic name before use.
 *  3. **A final pass over every emitted string.** Nothing leaves this module
 *     without going through `isBadgeTextPermitted`, whatever produced it.
 *
 * A badge that fails is **omitted**, never degraded into something vaguer. A
 * vague badge is still a badge, and the failure mode this guards against is a
 * family reading more into one than it says.
 */

/* -------------------------------------------------------------------------
 * The prohibition
 * ---------------------------------------------------------------------- */

/**
 * Words and phrases that may not appear in any badge, anywhere in the product
 * — including marketing copy, i18n strings, alt text and the README
 * (CLAUDE.md §2.5).
 *
 * The list covers the specification's named terms plus the obvious neighbours.
 * Matching is done on a normalised form, so `Back-Ground Checked`,
 * `POLICE_VERIFIED` and `police   verified` are all caught.
 */
export const FORBIDDEN_BADGE_TERMS: readonly string[] = [
  // Named in FR-6.8 and CLAUDE.md §2.5.
  'trusted',
  'trustworthy',
  'safe',
  'safety checked',
  'vetted',
  'background checked',
  'background check',
  'police verified',
  'police check',
  'police cleared',
  'screened',
  'certified safe',
  // The same claim by another name.
  'criminal record',
  'criminal check',
  'crb',
  'dbs',
  'clearance',
  'cleared',
  'no criminal',
  'guaranteed',
  'guarantee',
  'endorsed',
  'approved by police',
  'security cleared',
  'fully checked',
  'fully verified',
  'background screened',
];

/**
 * Lowercase, strip everything that is not a letter or a digit, collapse to
 * single spaces.
 *
 * `Back-Ground  Checked!` and `backgroundchecked` both reduce to a form the
 * term list matches. The space-free comparison is done separately below, so a
 * term run together is caught too.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface BadgeRejection {
  text: string;
  matchedTerm: string;
}

/** The forbidden term this text contains, or `null` if it contains none. */
export function findForbiddenTerm(text: string): string | null {
  const spaced = normalise(text);
  const squashed = spaced.replace(/ /g, '');

  for (const term of FORBIDDEN_BADGE_TERMS) {
    const normalisedTerm = normalise(term);
    if (spaced.includes(normalisedTerm)) return term;
    if (squashed.includes(normalisedTerm.replace(/ /g, ''))) return term;
  }
  return null;
}

export function isBadgeTextPermitted(text: string): boolean {
  return findForbiddenTerm(text) === null;
}

/* -------------------------------------------------------------------------
 * The closed template set
 * ---------------------------------------------------------------------- */

/** The artefacts an administrator can actually check (FR-6.5). */
export const VERIFIABLE_ARTEFACTS = ['cnic', 'degree', 'transcript'] as const;
export type VerifiableArtefact = (typeof VERIFIABLE_ARTEFACTS)[number];

/**
 * One authored string per artefact, in both languages.
 *
 * Each says what was looked at and stops. "CNIC verified by Ustaad.com" is a
 * statement about a document; "Trusted" would be a statement about a person.
 */
const ARTEFACT_BADGES: Record<VerifiableArtefact, { en: string; ur: string }> = {
  cnic: {
    en: 'CNIC verified by Ustaad.com',
    ur: 'شناختی کارڈ کی تصدیق اُستاد ڈاٹ کام نے کی',
  },
  degree: {
    en: 'Academic documents reviewed',
    ur: 'تعلیمی دستاویزات کا جائزہ لیا گیا',
  },
  transcript: {
    en: 'Academic transcript reviewed',
    ur: 'تعلیمی نتائج کا جائزہ لیا گیا',
  },
};

/** Shown wherever badges appear, so the boundary is stated and not inferred. */
export const VERIFICATION_SCOPE_NOTE = {
  en: 'Ustaad.com checks the documents listed above. No police check, background check or criminal-record clearance is performed.',
  ur: 'اُستاد ڈاٹ کام صرف اوپر درج دستاویزات کی جانچ کرتا ہے۔ پولیس، بیک گراؤنڈ یا مجرمانہ ریکارڈ کی جانچ نہیں کی جاتی۔',
} as const;

export type BadgeTrack = 'identity' | 'competency';

export interface Badge {
  /** Two independent tracks, displayed separately, never merged (FR-6.2). */
  track: BadgeTrack;
  text: string;
  textUr: string;
  /** ISO `YYYY-MM-DD`, for a competency badge that lapses (FR-28.1). */
  expiresOn?: string;
}

export interface BadgeInput {
  /** Artefacts an administrator recorded as checked. */
  artefactsChecked: readonly string[];
  /** Topics whose competency assessment is currently passed and unexpired. */
  verifiedTopics?: readonly { name: string; expiresOn?: string }[];
}

export interface BadgeResult {
  badges: Badge[];
  /**
   * Anything the guard refused. Never rendered; surfaced so that an
   * administrator can see a badge was withheld rather than wonder where it
   * went.
   */
  rejected: BadgeRejection[];
  scopeNote: typeof VERIFICATION_SCOPE_NOTE;
}

/**
 * A topic name safe to interpolate.
 *
 * Topic names come from the seeded reference table rather than from user
 * input, so this is defence against a future editing surface rather than
 * against today's data — but the badge guard has to hold for *any* input,
 * which is what the test asserts.
 */
function isInterpolationSafe(label: string): boolean {
  if (label.trim() === '' || label.length > 80) return false;
  // No control characters, no markup, no line breaks in a badge.
  if (/[<>{}\\\r\n\t]/.test(label)) return false;
  return isBadgeTextPermitted(label);
}

/**
 * Build the badges for a verification state.
 *
 * Never throws and never emits a forbidden phrase, for any input. A badge that
 * would breach the rule is omitted and reported in `rejected`.
 */
export function buildBadges(input: BadgeInput): BadgeResult {
  const badges: Badge[] = [];
  const rejected: BadgeRejection[] = [];

  const emit = (badge: Badge): void => {
    // Layer 3: whatever produced it, it does not leave without passing.
    for (const text of [badge.text, badge.textUr]) {
      const term = findForbiddenTerm(text);
      if (term !== null) {
        rejected.push({ text, matchedTerm: term });
        return;
      }
    }
    badges.push(badge);
  };

  // --- Identity track (administrator, manual) ---
  for (const artefact of VERIFIABLE_ARTEFACTS) {
    if (!input.artefactsChecked.includes(artefact)) continue;
    const template = ARTEFACT_BADGES[artefact];
    emit({ track: 'identity', text: template.en, textUr: template.ur });
  }

  // --- Competency track (AI, per topic) ---
  for (const topic of input.verifiedTopics ?? []) {
    if (!isInterpolationSafe(topic.name)) {
      rejected.push({
        text: topic.name,
        matchedTerm: findForbiddenTerm(topic.name) ?? 'unsafe-for-interpolation',
      });
      continue;
    }
    emit({
      track: 'competency',
      text: `Passed assessment: ${topic.name}`,
      textUr: `جانچ میں کامیاب: ${topic.name}`,
      ...(topic.expiresOn ? { expiresOn: topic.expiresOn } : {}),
    });
  }

  return { badges, rejected, scopeNote: VERIFICATION_SCOPE_NOTE };
}

/**
 * Strict variant, for tests and for a build-time check over i18n strings.
 *
 * @throws {Error} naming the offending term.
 */
export function assertBadgeTextPermitted(text: string): void {
  const term = findForbiddenTerm(text);
  if (term !== null) {
    throw new Error(
      `badge text "${text}" contains the prohibited term "${term}". Ustaad.com performs no ` +
        'police check, background check or criminal-record clearance, and no badge may imply ' +
        'one (FR-6.8, SEC-6).',
    );
  }
}
