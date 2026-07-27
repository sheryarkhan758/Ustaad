/**
 * Reference-data queries — §6.2, §6.3.
 *
 * ── Fetched once per session, not once per keystroke ───────────────────────
 * This is the only genuinely static data in the system: seeded from committed
 * files, containing no user information, changing only on deployment (§12). So
 * `staleTime: Infinity` — within a session these lists are never refetched, and
 * a searchable picker filters an array it already has rather than asking the
 * server on every character.
 *
 * That matters more here than anywhere else in the product. These pickers
 * appear on almost every screen, and the audience is on a metered connection.
 *
 * ── Names come back bilingual, with a deliberate fallback ──────────────────
 * `nameUr` is nullable. Many Pakistani place names are habitually written in
 * Latin even in Urdu text — "DHA", "F-10", "PECHS" — and inventing an Urdu
 * spelling nobody uses would be worse than showing the familiar one. `localName`
 * below implements the fallback in one place.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

import { api } from './api';

/** Static for the session. See the header. */
const STATIC = {
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 1,
};

export const referenceKeys = {
  provinces: ['reference', 'provinces'],
  cities: (provinceId) => ['reference', 'cities', provinceId ?? 'all'],
  areas: (cityId) => ['reference', 'areas', cityId ?? 'all'],
  adjacent: (ids) => ['reference', 'areas', 'adjacent', [...ids].sort().join(',')],
  subjects: ['reference', 'subjects'],
  levels: ['reference', 'levels'],
  boards: ['reference', 'boards'],
  topics: (subjectId, levelId, boardId) => ['reference', 'topics', subjectId, levelId, boardId],
  prerequisites: (ids) => ['reference', 'prerequisites', [...ids].sort().join(',')],
};

/* -------------------------------------------------------------------------
 * Location
 * ---------------------------------------------------------------------- */

export function useProvinces() {
  return useQuery({
    queryKey: referenceKeys.provinces,
    queryFn: async () => (await api.get('/reference/provinces')).items,
    ...STATIC,
  });
}

export function useCities(provinceId) {
  return useQuery({
    queryKey: referenceKeys.cities(provinceId),
    queryFn: async () =>
      (await api.get(`/reference/cities${provinceId ? `?provinceId=${provinceId}` : ''}`)).items,
    // Waiting for a province is the cascade: asking for every city in Pakistan
    // when the user has chosen Sindh is a list they then have to search twice.
    enabled: Boolean(provinceId),
    ...STATIC,
  });
}

export function useAreas(cityId) {
  return useQuery({
    queryKey: referenceKeys.areas(cityId),
    queryFn: async () => (await api.get(`/reference/areas?cityId=${cityId}`)).items,
    enabled: Boolean(cityId),
    ...STATIC,
  });
}

/**
 * FR-2.7 — areas a family would consider near enough.
 *
 * **A curated adjacency list, not a radius.** There is no map, no pin and no
 * coordinate anywhere in this product (§4.2), and the interface must not imply
 * one: "nearby" here means somebody decided these two areas are a short ride
 * apart, which is a judgement a distance calculation cannot make in a city
 * where a two-kilometre gap can be forty minutes.
 */
export function useAdjacentAreas(areaIds) {
  const ids = (areaIds ?? []).filter(Boolean);

  return useQuery({
    queryKey: referenceKeys.adjacent(ids),
    queryFn: async () =>
      (await api.get(`/reference/areas/adjacent?ids=${ids.join(',')}`)).items,
    enabled: ids.length > 0,
    ...STATIC,
  });
}

/* -------------------------------------------------------------------------
 * Curriculum
 * ---------------------------------------------------------------------- */

export function useSubjects() {
  return useQuery({
    queryKey: referenceKeys.subjects,
    queryFn: async () => (await api.get('/reference/subjects')).items,
    ...STATIC,
  });
}

export function useLevels() {
  return useQuery({
    queryKey: referenceKeys.levels,
    queryFn: async () => (await api.get('/reference/levels')).items,
    ...STATIC,
  });
}

export function useBoards() {
  return useQuery({
    queryKey: referenceKeys.boards,
    queryFn: async () => (await api.get('/reference/boards')).items,
    ...STATIC,
  });
}

/**
 * Topics for one curriculum **triple**.
 *
 * All three are required, and that is decision 5: a Sindh Board tutor and a
 * Cambridge tutor are not interchangeable, and neither are their topic lists.
 * The query stays disabled until the board is chosen rather than guessing one.
 */
export function useTopics({ subjectId, levelId, boardId }) {
  return useQuery({
    queryKey: referenceKeys.topics(subjectId, levelId, boardId),
    queryFn: async () =>
      (
        await api.get(
          `/reference/topics?subjectId=${subjectId}&levelId=${levelId}&boardId=${boardId}`,
        )
      ).items,
    enabled: Boolean(subjectId && levelId && boardId),
    ...STATIC,
  });
}

/**
 * The prerequisite graph reachable from a set of topics — §2.4, FR-3.4.
 *
 * Returns `{ edges, topics }` rather than a tree. The chain is a path through a
 * graph — a topic can have two prerequisites and be a prerequisite of two
 * others — and flattening it to a tree on the server would throw away the shape
 * the browser needs to draw.
 */
export function usePrerequisites(topicIds) {
  const ids = (topicIds ?? []).filter(Boolean);

  return useQuery({
    queryKey: referenceKeys.prerequisites(ids),
    queryFn: async () =>
      api.get(`/reference/topics/prerequisites?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
    ...STATIC,
  });
}

/* -------------------------------------------------------------------------
 * Naming
 * ---------------------------------------------------------------------- */

/**
 * The name to show, in the active language, with the fallback in one place.
 *
 * Returns `{ text, lang }` rather than a bare string, so the caller can set
 * `lang` on the element. That matters: an area whose `nameUr` is null renders
 * its Latin name inside an Urdu page, and telling the browser it is English
 * gets the right font and the right screen-reader voice for those two words.
 */
export function useLocalName() {
  const { i18n } = useTranslation();
  const lng = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  return useCallback(
    (row) => {
      if (!row) return { text: '', lang: lng };
      if (lng === 'ur' && row.nameUr) return { text: row.nameUr, lang: 'ur' };
      // Falling back to the Latin name in an Urdu page — see the header.
      return { text: row.name ?? '', lang: lng === 'ur' ? 'en' : lng };
    },
    [lng],
  );
}
