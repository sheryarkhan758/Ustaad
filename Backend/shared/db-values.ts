/**
 * The value helpers every portable column goes through.
 *
 * Their existence is the reason `server/db/schema/` contains no column type
 * that means something different in SQLite and in Postgres.  See
 * `server/db/PORTABILITY.md` for the rules these implement and why each one
 * exists.
 *
 * The short version: a column is stored as `text`, `integer` or `real`, and
 * nothing else.  Those three builders have identical signatures and identical
 * semantics in `drizzle-orm/sqlite-core` and `drizzle-orm/pg-core`, so the
 * schema files differ between dialects by exactly one import line.  Anything
 * richer — a boolean type, a JSON type, a timestamp type — is where the two
 * engines diverge, so it is done here, in TypeScript, on values.
 */

import { randomUUID } from 'node:crypto';

/* -------------------------------------------------------------------------
 * Identifiers
 * ---------------------------------------------------------------------- */

/**
 * Application-generated primary key (UUID v4).
 *
 * Never `AUTOINCREMENT`, never a Postgres sequence.  Engine-generated ids are
 * the single most expensive thing to migrate: the semantics differ, the
 * recovery of the generated value differs, and a sequence left behind after a
 * bulk import silently collides on the next insert.  Generating here means an
 * id exists before the row does, which also removes any need to read one back.
 */
export function newId(): string {
  return randomUUID();
}

/* -------------------------------------------------------------------------
 * Timestamps — ISO-8601 UTC text
 * ---------------------------------------------------------------------- */

/**
 * `2026-07-26T05:16:16.123Z` — always UTC, always millisecond precision,
 * always 24 characters.
 *
 * Fixed width matters: lexicographic ordering of this format is chronological
 * ordering, so `ORDER BY created_at` and `WHERE created_at > ?` behave
 * identically in both engines with no cast and no function call.
 *
 * Text rather than integer epoch because Postgres `integer` is four bytes and
 * epoch milliseconds overflow it (1.7e12 against a 2.1e9 ceiling).  Storing
 * epoch would force `bigint` on one side and `integer` on the other — a
 * dialect-specific column type, which is the thing this file exists to avoid.
 * It is also readable in `psql` without conversion, which matters on
 * deployment day.
 *
 * **Never** `datetime('now')`, `date()`, `strftime()`, `CURRENT_TIMESTAMP` or
 * any database-side default.  The clock is the application's.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function toDbTimestamp(value: Date): string;
export function toDbTimestamp(value: Date | null | undefined): string | null;
export function toDbTimestamp(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Number.isNaN(value.getTime())) {
    throw new RangeError('cannot store an invalid Date');
  }
  return value.toISOString();
}

export function fromDbTimestamp(value: string): Date;
export function fromDbTimestamp(value: string | null | undefined): Date | null;
export function fromDbTimestamp(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`stored timestamp is not a valid ISO-8601 string: "${value}"`);
  }
  return parsed;
}

/* -------------------------------------------------------------------------
 * Booleans — integer 0 / 1
 * ---------------------------------------------------------------------- */

/**
 * SQLite has no boolean type and will happily store `'yes'`, `'true'` or `'Y'`
 * in a column you are treating as a flag; Postgres has a real `boolean` and
 * will reject all three.  A codebase that drifts into truthy text discovers it
 * on migration day, one column at a time.
 *
 * So every flag is `integer` holding exactly 0 or 1 in both engines, and
 * crosses the boundary through this pair.  `fromDbBool` is strict on purpose:
 * a value that is neither 0 nor 1 is corruption, and reading it as `true`
 * because it happens to be truthy would hide that.
 */
export function toDbBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromDbBool(value: number): boolean;
export function fromDbBool(value: number | null | undefined): boolean | null;
export function fromDbBool(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  if (value !== 0 && value !== 1) {
    throw new RangeError(`boolean column holds ${JSON.stringify(value)}; expected 0 or 1`);
  }
  return value === 1;
}

/* -------------------------------------------------------------------------
 * JSON — text, one serialiser
 * ---------------------------------------------------------------------- */

export class JsonColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonColumnError';
  }
}

/**
 * JSON is stored as `text` in both engines and passes through here.
 *
 * Postgres `jsonb` is genuinely better — it indexes, it queries, it validates.
 * It is deliberately not used, because using it would mean either writing
 * `jsonb` operators that SQLite cannot run, or maintaining two query paths.
 * The column is a serialised blob the application parses; no query ever reaches
 * inside it (no `JSON_EXTRACT`, no `->>`), which is what keeps it portable.
 *
 * `undefined` and `null` both store as SQL NULL rather than the string
 * `"null"`, because a column that is absent and a column containing JSON null
 * are different things and only one of them survives a round trip cleanly.
 */
export function toDbJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new JsonColumnError(
      `value is not JSON-serialisable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function fromDbJson<T>(value: string | null | undefined): T | null;
export function fromDbJson<T>(value: string | null | undefined, fallback: T): T;
export function fromDbJson<T>(value: string | null | undefined, fallback?: T): T | null {
  if (value === null || value === undefined || value === '') {
    return fallback === undefined ? null : fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new JsonColumnError(
      `stored JSON is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Convenience for the common `string[]` case, defaulting to `[]`. */
export function fromDbJsonArray(value: string | null | undefined): string[] {
  return fromDbJson<string[]>(value, []);
}

/** Serialised empty array / object, for column defaults. */
export const EMPTY_JSON_ARRAY = '[]';
export const EMPTY_JSON_OBJECT = '{}';
