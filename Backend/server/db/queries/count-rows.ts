/**
 * The one raw SQL fragment in this codebase, isolated behind a named function
 * as CLAUDE.md §2.1 requires.
 *
 * **Why it cannot be expressed in the query builder:** Drizzle has no portable
 * `count()` aggregate that returns a scalar across both dialects in the version
 * pinned here. Selecting every row and taking `.length` would work but reads
 * the whole table, which is exactly what a verification step over 46 tables
 * must not do.
 *
 * **Why it is safe to port:** `count(*)` is identical in SQLite and Postgres.
 * It takes no user input, so there is no value to parameterise and no injection
 * surface. It is called only by the seed runner and by
 * `scripts/verify-row-counts.ts` — never by a route handler.
 */

import { sql } from 'drizzle-orm';

import type { Executor } from '../../repositories/_base';

/** Number of rows in `table`. */
export async function countRows(db: Executor, table: unknown): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from(table as any);
  return Number(rows[0]?.n ?? 0);
}
