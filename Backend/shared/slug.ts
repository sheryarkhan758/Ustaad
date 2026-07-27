/**
 * Public profile slugs — §6.21.
 *
 * A tutor's profile is shareable by URL and by QR code, so the slug is part of
 * the product rather than an internal key. It is derived from the display name,
 * which means two tutors called Ayesha Khan will collide, and collisions are
 * resolved rather than rejected.
 *
 * Names on this platform are frequently Urdu script or Roman Urdu. Latin
 * transliteration is **not** attempted: transliterating عائشہ خان to "aisha
 * khan" is a guess about a person's name, and the platform's rule is that user
 * text is stored and shown as written (CLAUDE.md §2.10). A name that yields no
 * Latin characters gets a stable neutral slug instead, which is honest about
 * the fact that the URL is not the name.
 */

/** Reserved because they collide with real or planned routes. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'auth',
  'search',
  'tutors',
  'parents',
  'students',
  'bookings',
  'reviews',
  'payments',
  'volunteer',
  'feedback',
  'about',
  'help',
  'login',
  'logout',
  'register',
  'me',
  'new',
  'edit',
  'settings',
  'null',
  'undefined',
]);

export const SLUG_MAX_LENGTH = 48;

/**
 * The candidate slug for a display name, before collision handling.
 *
 * Returns an empty string when the name yields nothing usable — the caller
 * substitutes a neutral base rather than inventing a transliteration.
 */
export function slugifyName(displayName: string): string {
  return (
    displayName
      .normalize('NFKD')
      // Strip combining marks left by NFKD on Latin accents (é → e). This does
      // not touch Urdu, which is not decomposed this way.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX_LENGTH)
      .replace(/-+$/, '')
  );
}

/**
 * A stable neutral base for a name that produces no Latin characters.
 *
 * Not reserved, deliberately: the first such tutor should get `tutor`, not
 * `tutor-2`, which would imply a `tutor-1` that never existed. The plural
 * `tutors` is reserved because that is the route namespace; the singular is not
 * a route.
 */
export function neutralSlugBase(): string {
  return 'tutor';
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/**
 * Resolve a unique slug.
 *
 * `isTaken` is supplied by the caller so this stays pure and testable without a
 * database. Suffixes are `-2`, `-3`, … rather than random, so a second Ayesha
 * Khan gets `ayesha-khan-2` and not `ayesha-khan-7f3a`; the URL stays something
 * a person can read out over the phone, which is how this market shares things.
 *
 * @throws {RangeError} after `maxAttempts`, rather than looping forever.
 */
export async function resolveUniqueSlug(
  displayName: string,
  isTaken: (candidate: string) => Promise<boolean>,
  maxAttempts = 200,
): Promise<string> {
  const base = slugifyName(displayName) || neutralSlugBase();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`;

    // A reserved word is skipped at attempt 1 but `admin-2` is fine: the
    // collision is with the route `/admin`, not with the string.
    if (attempt === 1 && isReservedSlug(candidate)) continue;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new RangeError(
    `could not find a free slug for "${displayName}" after ${maxAttempts} attempts`,
  );
}
