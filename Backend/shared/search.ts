/**
 * Search query contract — §6.7, §6.16.
 *
 * ── The one rule that shapes this whole file ───────────────────────────────
 * `genderPreference` is a **hard exclusion**, applied in the SQL predicate
 * before anything is ranked (FR-16.3, FR-16.4, decision 8). A family searching
 * `female_only` receives a result set from which every male tutor is *absent*.
 * Not ranked lower. Not greyed out. Not filtered by the client.
 *
 * §2.1 is why. In households where daughters are not permitted to travel, a
 * female tutor who teaches at home is not a preference to be accommodated at
 * the margins — it is the only arrangement under which any tuition happens at
 * all. A platform that shows such a family male tutors is unusable to them, and
 * they leave.
 *
 * The default is `no_preference`, and **the system never pre-sets the filter on
 * a user's behalf** (FR-16.6).
 */

import { z } from 'zod';

import { TEACHING_MODES } from './rates';

export const GENDER_PREFERENCES = ['female_only', 'male_only', 'no_preference'] as const;
export type GenderPreference = (typeof GENDER_PREFERENCES)[number];

export const ENGAGEMENT_FILTERS = [
  'monthly',
  'short_term_package',
  'single_session',
  'group',
] as const;

export const SEARCH_SORTS = ['relevance', 'rate_asc', 'rate_desc', 'reviews', 'response_time'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** `HH:MM`, whose lexicographic order is chronological. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const searchQuerySchema = z
  .object({
    /* --- curriculum --- */
    subjectId: z.string().min(1).optional(),
    levelId: z.string().min(1).optional(),
    boardId: z.string().min(1).optional(),
    /** Repeatable. Matched against materialised per-topic scores. */
    topicIds: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]))
      .pipe(z.array(z.string().min(1)).max(20).optional()),

    /* --- location --- */
    cityId: z.string().min(1).optional(),
    areaId: z.string().min(1).optional(),
    /** Nearby-area expansion via `area_adjacency` (FR-2.9, FR-7.7). */
    includeAdjacentAreas: z.coerce.boolean().default(false),

    /* --- engagement --- */
    mode: z.enum(TEACHING_MODES).optional(),
    engagementType: z.enum(ENGAGEMENT_FILTERS).optional(),

    /**
     * The hard exclusion. Defaults to `no_preference`; the system never sets
     * it to anything else on the user's behalf (FR-16.6).
     */
    genderPreference: z.enum(GENDER_PREFERENCES).default('no_preference'),

    /* --- price --- */
    /** Paisa per hour, normalised. Compared against `normalised_hourly_amount`. */
    maxHourlyRate: z.coerce.number().int().positive().optional(),

    /* --- other filters --- */
    verifiedOnly: z.coerce.boolean().default(false),
    volunteerOnly: z.coerce.boolean().default(false),
    /** A weekly recurring window the tutor must cover. */
    availableWeekday: z.coerce.number().int().min(0).max(6).optional(),
    availableFrom: timeOfDay.optional(),
    availableTo: timeOfDay.optional(),

    /* --- paging --- */
    sort: z.enum(SEARCH_SORTS).default('relevance'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine(
    (v) => !(v.availableFrom && v.availableTo) || v.availableFrom < v.availableTo,
    { path: ['availableTo'], message: 'the window must end after it starts' },
  )
  .refine((v) => !v.includeAdjacentAreas || v.areaId !== undefined, {
    path: ['includeAdjacentAreas'],
    message: 'choose an area before including nearby ones',
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * `verifiedOnly` narrows to tutors with a **live per-topic competency pass**.
 *
 * It does not mean "identity verified" — every tutor in any result set is
 * already identity-approved, because an unapproved profile is not searchable at
 * all (FR-6.3). Offering a filter for something that is always true would
 * suggest the opposite is possible.
 */
export const VERIFIED_ONLY_MEANS = 'live competency assessment for the searched topic' as const;
