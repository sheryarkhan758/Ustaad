// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/reference.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reference data — static, seeded, read-only.  Specification §9.1.
 *
 * Nothing in this file holds user information.  These tables are populated
 * exclusively by `server/db/seed/reference.ts`, which is committed to the
 * repository (§12).  No runtime path writes to them.
 *
 * Design decisions that matter for the Postgres migration (CLAUDE.md §2.1):
 *
 *  - **Primary keys are text slugs, not integers.**  Reference rows are static
 *    and hand-authored, so a stable readable key is better than a generated
 *    one: seeds stay legible, re-seeding is idempotent, foreign keys are
 *    self-documenting, and there is no AUTOINCREMENT or sequence behaviour to
 *    depend on — which is exactly the SQLite-only semantics the invariants
 *    forbid.  The slug *is* the code.
 *  - Timestamps, where present, are integer epoch milliseconds written from
 *    application code.  No database-side default, no `datetime()`.
 *  - Enumerations are declared as text with a Drizzle `enum` constraint, which
 *    ports to Postgres as a text column plus the same application-side union.
 */

import { index, primaryKey, pgTable, text, integer } from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------
 * Location taxonomy — §6.2
 *
 * Province → City → Area.  **Area is the finest granularity in this project.**
 * There is no latitude, no longitude, no GPS, no map tile, no geocoding and no
 * distance-in-kilometres column, here or anywhere else.  Live location is
 * explicitly out of scope (§4.2) because the platform coordinates adults
 * visiting homes where minors live.  Proximity is expressed only by
 * `area_adjacency` below, in travel minutes.
 * ---------------------------------------------------------------------- */

export const provinces = pgTable('provinces', {
  /** Slug, e.g. `sindh`, `islamabad-capital-territory`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /**
   * Urdu name — §6.27, FR-27.4.
   *
   * **Nullable, deliberately.** Many Pakistani place names are habitually
   * written in Latin script even in otherwise-Urdu text ("DHA", "F-10",
   * "PECHS"), and inventing an Urdu spelling nobody uses would be worse than
   * showing the familiar one. A null means "render `name` as it is", which the
   * client does — it is a fallback, not a missing translation.
   */
  nameUr: text('name_ur'),
  /** Short official code, e.g. `SD`, `PB`, `ICT`. */
  code: text('code').notNull().unique(),
});

export const cities = pgTable(
  'cities',
  {
    /** Slug, e.g. `karachi`. */
    id: text('id').primaryKey(),
    provinceId: text('province_id')
      .notNull()
      .references(() => provinces.id),
    name: text('name').notNull(),
  /**
   * Urdu name — §6.27, FR-27.4.
   *
   * **Nullable, deliberately.** Many Pakistani place names are habitually
   * written in Latin script even in otherwise-Urdu text ("DHA", "F-10",
   * "PECHS"), and inventing an Urdu spelling nobody uses would be worse than
   * showing the familiar one. A null means "render `name` as it is", which the
   * client does — it is a fallback, not a missing translation.
   */
    nameUr: text('name_ur'),
  },
  (t) => [index('idx_cities_province').on(t.provinceId)],
);

export const areas = pgTable(
  'areas',
  {
    /** Slug, city-qualified, e.g. `karachi-gulshan-e-iqbal`. */
    id: text('id').primaryKey(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
  /**
   * Urdu name — §6.27, FR-27.4.
   *
   * **Nullable, deliberately.** Many Pakistani place names are habitually
   * written in Latin script even in otherwise-Urdu text ("DHA", "F-10",
   * "PECHS"), and inventing an Urdu spelling nobody uses would be worse than
   * showing the familiar one. A null means "render `name` as it is", which the
   * client does — it is a fallback, not a missing translation.
   */
    nameUr: text('name_ur'),
  },
  (t) => [index('idx_areas_city').on(t.cityId)],
);

/**
 * Adjacency between two areas **within the same city** (FR-2.9).
 *
 * Stored as symmetric pairs: an adjacency between A and B is two rows, A→B and
 * B→A, carrying the same `travelMinutes`.  The seed validator enforces both the
 * symmetry and the same-city rule and refuses to write if either is broken.
 *
 * `travelMinutes` is a coarse human estimate of ordinary road travel time.  It
 * is not derived from coordinates and is never presented as a distance.
 * Consumed later by nearby-area expansion in search (FR-7.7) and by group
 * matching (§6.23).
 */
export const areaAdjacency = pgTable(
  'area_adjacency',
  {
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    adjacentAreaId: text('adjacent_area_id')
      .notNull()
      .references(() => areas.id),
    travelMinutes: integer('travel_minutes').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.areaId, t.adjacentAreaId] }),
    index('idx_area_adjacency_adjacent').on(t.adjacentAreaId),
  ],
);

/* -------------------------------------------------------------------------
 * Curriculum taxonomy — §6.3
 * ---------------------------------------------------------------------- */

export const subjects = pgTable('subjects', {
  /** Slug, e.g. `mathematics`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Urdu name, stored as authored.  Interface label, not user content. */
  nameUr: text('name_ur').notNull(),
});

export const levels = pgTable(
  'levels',
  {
    /** Slug, e.g. `matric`, `intermediate`, `o-level`. */
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Ascending academic order.  Sort in SQL on this, never on `name`. */
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [index('idx_levels_sort').on(t.sortOrder)],
);

/**
 * Examination board — a first-class field, not a tag (decision 5, FR-3.1).
 *
 * A Sindh Board tutor and a Cambridge tutor are not interchangeable: different
 * syllabus, different chapter sequence, different paper pattern, different
 * marking. Board therefore keys `topics` alongside subject and level, and every
 * tutor claim, search filter and booking carries it. Nothing in this system may
 * silently fall back to "any board".
 */
export const boards = pgTable('boards', {
  /** Slug, e.g. `sindh-board`, `cambridge`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameUr: text('name_ur').notNull(),
});

/**
 * A teachable unit, scoped to one (subject, level, board) triple.
 *
 * The same-named chapter under two boards is two rows, deliberately: "Quadratic
 * Equations" in the Sindh Board Matric syllabus is not the same unit of work as
 * "Quadratic Equations" in Cambridge O Level, and a prerequisite edge drawn
 * between them would be wrong.
 */
export const topics = pgTable(
  'topics',
  {
    /** Slug, e.g. `math-matric-sindh-quadratic-equations`. */
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id),
    levelId: text('level_id')
      .notNull()
      .references(() => levels.id),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    name: text('name').notNull(),
    nameUr: text('name_ur').notNull(),
    /** Human chapter citation, e.g. `Class 10 · Ch 1`.  Display only. */
    chapterRef: text('chapter_ref'),
    /** Position within its (subject, level, board) syllabus. */
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('idx_topics_curriculum').on(t.subjectId, t.levelId, t.boardId),
    index('idx_topics_subject').on(t.subjectId),
  ],
);

/**
 * Directed acyclic graph of prerequisites (FR-3.3, FR-3.4).
 *
 * An edge `(topicId, prerequisiteTopicId)` reads "topicId requires
 * prerequisiteTopicId first".  This is the structure §2.4 of the specification
 * is about: a student failing quadratic equations usually has an unrepaired
 * weakness two chapters upstream, and the diagnostic agent (§6.10) walks this
 * graph to find it.
 *
 * Acyclicity is not decorative — a cycle would make the walk non-terminating
 * and the gap map meaningless.  The seed refuses to write a graph containing a
 * cycle and prints the offending path.  See `server/db/seed/validate.ts`.
 */
export const topicPrerequisites = pgTable(
  'topic_prerequisites',
  {
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    prerequisiteTopicId: text('prerequisite_topic_id')
      .notNull()
      .references(() => topics.id),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.prerequisiteTopicId] }),
    index('idx_topic_prereq_prerequisite').on(t.prerequisiteTopicId),
  ],
);

/**
 * Service categories (FR-3.7, §6.29).
 *
 * "Home tuition with mentoring" is the restricted-mobility pathway's service
 * type (§2.1) and is a first-class category, not a note on a profile.
 */
export const serviceTypes = pgTable('service_types', {
  /** Slug, e.g. `home-tuition-mentoring`. */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameUr: text('name_ur').notNull(),
  /** Ordering for the picker. */
  sortOrder: integer('sort_order').notNull(),
});

/* -------------------------------------------------------------------------
 * Interface strings — §6.27
 * ---------------------------------------------------------------------- */

export const LANGS = ['en', 'ur'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Authored interface copy, keyed by (key, lang).
 *
 * This table is **not** a translation service.  It holds strings the project
 * wrote in both languages.  User-generated text — reviews, biographies,
 * feedback, session notes — is stored exactly as entered and is never machine
 * translated (decision 13, CLAUDE.md §2.10).  The two never mix.
 */
export const i18nStrings = pgTable(
  'i18n_strings',
  {
    key: text('key').notNull(),
    lang: text('lang', { enum: LANGS }).notNull(),
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.lang] }), index('idx_i18n_lang').on(t.lang)],
);

/* -------------------------------------------------------------------------
 * Inferred types
 * ---------------------------------------------------------------------- */

export type Province = typeof provinces.$inferSelect;
export type City = typeof cities.$inferSelect;
export type Area = typeof areas.$inferSelect;
export type AreaAdjacency = typeof areaAdjacency.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type Level = typeof levels.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type TopicPrerequisite = typeof topicPrerequisites.$inferSelect;
export type ServiceType = typeof serviceTypes.$inferSelect;
export type I18nString = typeof i18nStrings.$inferSelect;
