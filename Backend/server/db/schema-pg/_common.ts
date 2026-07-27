// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/_common.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Portable column builders.
 *
 * **Every column in every schema file is declared through this module or
 * through `text` / `integer` / `real` directly.**  Those three builders have
 * identical signatures and identical semantics in `drizzle-orm/sqlite-core` and
 * `drizzle-orm/pg-core`, which is what lets `server/db/schema-pg/` be generated
 * from `server/db/schema/` by swapping one import line per file.
 *
 * Nothing here uses a Drizzle `mode:` variant — not `mode: 'boolean'`, not
 * `mode: 'json'`, not `mode: 'timestamp_ms'`.  Those are precisely the places
 * where the two dialects produce different SQL, and they are handled on values
 * in `shared/db-values.ts` instead.  See `server/db/PORTABILITY.md`.
 *
 * This file declares no tables; drizzle-kit reads it as part of the schema glob
 * and finds nothing to migrate, which is intended.
 */

import { integer, text } from 'drizzle-orm/pg-core';

import { EMPTY_JSON_ARRAY, newId, nowIso } from '../../../shared/db-values';

/**
 * Text primary key, UUID generated in application code.
 * Never `AUTOINCREMENT`, never a sequence (PORTABILITY rule 5).
 */
export const pk = () => text('id').primaryKey().$defaultFn(newId);

/**
 * ISO-8601 UTC text, fixed width, stamped by the application on insert.
 * Never a database default, never `datetime('now')` (PORTABILITY rule 1).
 */
export const createdAt = () => text('created_at').notNull().$defaultFn(nowIso);

/** ISO-8601 UTC text, nullable — set when the event actually happens. */
export const timestampCol = (column: string) => text(column);

/**
 * Integer 0 or 1.  Read and written through `toDbBool` / `fromDbBool`
 * (PORTABILITY rule 2).  Not `mode: 'boolean'`, which becomes a real `boolean`
 * column in Postgres and a loosely-typed integer in SQLite.
 */
export const boolCol = (column: string) => integer(column);

/**
 * Serialised JSON held as text.  Read and written through `toDbJson` /
 * `fromDbJson` (PORTABILITY rule 3).  No query ever reaches inside it.
 */
export const jsonCol = (column: string) => text(column);

/** A JSON column defaulting to `[]` rather than NULL. */
export const jsonArrayCol = (column: string) =>
  text(column).notNull().$defaultFn(() => EMPTY_JSON_ARRAY);

/**
 * A monetary column: **integer paisa** (1 PKR = 100 paisa), never a float and
 * never a decimal string.  Postgres `integer` tops out at 2,147,483,647 paisa
 * — PKR 21.4 million — which is far above any rate, benchmark or cycle amount
 * this platform records.  Aggregate totals are computed in TypeScript and
 * never stored, so the ceiling is not reachable by accumulation.
 */
export const paisa = (column: string) => integer(column);
