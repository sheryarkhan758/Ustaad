/**
 * Reference-data reads — §6.2, §6.3.
 *
 * Locations, curriculum and the prerequisite graph. This is the data the two
 * cascading pickers are built from, and it is the only data in the system that
 * is genuinely **static**: it is seeded from committed files, contains no user
 * information, and changes only when somebody edits a seed and redeploys (§12).
 *
 * That is why the routes above this layer cache hard and the client fetches
 * each list once per session. A picker that refetched the area list on every
 * keystroke would spend a metered connection on data that cannot have changed.
 */

import { eq, inArray } from 'drizzle-orm';

import {
  areaAdjacency,
  areas,
  boards,
  cities,
  levels,
  provinces,
  serviceTypes,
  subjects,
  topicPrerequisites,
  topics,
} from '../db/schema/reference';
import type { Executor } from './_base';

/**
 * `nameUr` is nullable throughout.
 *
 * Many Pakistani place names are habitually written in Latin script even in
 * otherwise-Urdu text — "DHA", "F-10", "PECHS" — and inventing an Urdu spelling
 * nobody uses would be worse than showing the familiar one. A null means
 * "render `name` as it stands", which is a deliberate fallback rather than a
 * missing translation, and the client treats it that way.
 */
export interface NamedRow {
  id: string;
  name: string;
  nameUr: string | null;
}

export async function listProvinces(db: Executor) {
  return db
    .select({ id: provinces.id, name: provinces.name, nameUr: provinces.nameUr, code: provinces.code })
    .from(provinces)
    .orderBy(provinces.name);
}

export async function listCities(db: Executor, provinceId?: string) {
  const rows = db
    .select({
      id: cities.id,
      provinceId: cities.provinceId,
      name: cities.name,
      nameUr: cities.nameUr,
    })
    .from(cities);

  return provinceId
    ? rows.where(eq(cities.provinceId, provinceId)).orderBy(cities.name)
    : rows.orderBy(cities.name);
}

export async function listAreas(db: Executor, cityId?: string) {
  const rows = db
    .select({ id: areas.id, cityId: areas.cityId, name: areas.name, nameUr: areas.nameUr })
    .from(areas);

  return cityId ? rows.where(eq(areas.cityId, cityId)).orderBy(areas.name) : rows.orderBy(areas.name);
}

/**
 * Areas adjacent to the given ones — FR-2.7.
 *
 * Adjacency is stored symmetrically (both `(a,b)` and `(b,a)` rows exist), so
 * one lookup on `area_id` is sufficient and no union is needed.
 *
 * **This is the finest location granularity in the product.** There is no map,
 * no pin, no latitude and no longitude anywhere in this system (§4.2), and
 * "neighbouring areas" means exactly "areas a person considers walkable or a
 * short ride away", curated by hand in the seed. It is not a radius.
 */
export async function listAdjacentAreas(db: Executor, areaIds: string[]): Promise<string[]> {
  if (areaIds.length === 0) return [];

  const rows = await db
    .select({ adjacentAreaId: areaAdjacency.adjacentAreaId })
    .from(areaAdjacency)
    .where(inArray(areaAdjacency.areaId, areaIds));

  // The seeds themselves are excluded: a caller asking "what is next to
  // Clifton" does not mean Clifton.
  const seeds = new Set(areaIds);
  return [...new Set(rows.map((row) => row.adjacentAreaId))].filter((id) => !seeds.has(id)).sort();
}

/* -------------------------------------------------------------------------
 * Curriculum — §6.3
 * ---------------------------------------------------------------------- */

export async function listSubjects(db: Executor) {
  return db
    .select({ id: subjects.id, name: subjects.name, nameUr: subjects.nameUr })
    .from(subjects)
    .orderBy(subjects.name);
}

export async function listLevels(db: Executor) {
  // Sorted by the curriculum's own order, not alphabetically: Matric comes
  // after Middle and before Intermediate, which no alphabet agrees with.
  return db
    .select({ id: levels.id, name: levels.name, sortOrder: levels.sortOrder })
    .from(levels)
    .orderBy(levels.sortOrder);
}

export async function listBoards(db: Executor) {
  return db
    .select({ id: boards.id, name: boards.name, nameUr: boards.nameUr })
    .from(boards)
    .orderBy(boards.name);
}

/**
 * Topics for one curriculum triple — subject, level **and board**.
 *
 * The board is not optional, and that is decision 5: a Sindh Board tutor and a
 * Cambridge tutor are not interchangeable, and neither are their topic lists.
 * Returning topics for a subject and level alone would produce a list that is
 * wrong for whichever board the family actually sits.
 */
export async function listTopics(
  db: Executor,
  query: { subjectId: string; levelId: string; boardId: string },
) {
  return db
    .select({
      id: topics.id,
      subjectId: topics.subjectId,
      levelId: topics.levelId,
      boardId: topics.boardId,
      name: topics.name,
      nameUr: topics.nameUr,
      chapterRef: topics.chapterRef,
      sortOrder: topics.sortOrder,
    })
    .from(topics)
    .where(
      // All three, always.
      eq(topics.subjectId, query.subjectId),
    )
    .orderBy(topics.sortOrder)
    .then((rows) =>
      rows.filter((row) => row.levelId === query.levelId && row.boardId === query.boardId),
    );
}

/**
 * Every prerequisite edge for a set of topics.
 *
 * Returned as edges rather than as a tree, because the client walks them: the
 * §2.4 worked example — quadratic equations depends on algebraic factorisation,
 * which depends on signed-number arithmetic — is a *chain through a graph*, and
 * flattening it here would throw away the shape the browser needs to draw.
 *
 * The graph is acyclic and board-scoped, which the seed validates.
 */
export async function listPrerequisiteEdges(db: Executor, topicIds: string[]) {
  if (topicIds.length === 0) return [];

  return db
    .select({
      topicId: topicPrerequisites.topicId,
      prerequisiteTopicId: topicPrerequisites.prerequisiteTopicId,
    })
    .from(topicPrerequisites)
    .where(inArray(topicPrerequisites.topicId, topicIds));
}

/** Topics by id, for naming the nodes of a prerequisite chain. */
export async function listTopicsByIds(db: Executor, topicIds: string[]) {
  if (topicIds.length === 0) return [];

  return db
    .select({
      id: topics.id,
      subjectId: topics.subjectId,
      levelId: topics.levelId,
      boardId: topics.boardId,
      name: topics.name,
      nameUr: topics.nameUr,
      chapterRef: topics.chapterRef,
      sortOrder: topics.sortOrder,
    })
    .from(topics)
    .where(inArray(topics.id, topicIds));
}

export async function listServiceTypes(db: Executor) {
  return db
    .select({ id: serviceTypes.id, name: serviceTypes.name, nameUr: serviceTypes.nameUr })
    .from(serviceTypes)
    .orderBy(serviceTypes.sortOrder);
}
