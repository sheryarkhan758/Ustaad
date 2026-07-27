/**
 * Shared machinery for the repository layer.
 *
 * ── What a repository is for ───────────────────────────────────────────────
 * Route handlers call repositories.  **Route handlers never touch `db`.**  That
 * boundary is what makes the SQLite → Postgres move survivable: the set of SQL
 * this application can emit is confined to `server/repositories/`, so it is
 * small enough to review, and a query that would behave differently on the two
 * engines has exactly one place it can be written.
 *
 * ── The two jobs every repository does ─────────────────────────────────────
 * 1. **Translate at the boundary.**  Rows come out of the database with
 *    integers where the domain wants booleans and text where it wants objects
 *    and dates.  A repository maps a stored row to a domain object on the way
 *    out and back on the way in, through `shared/db-values.ts` and nothing
 *    else.  No caller ever sees a `0` that means `false`.
 * 2. **Never assume RETURNING.**  Ids are generated in application code, so a
 *    write knows the id before it happens.  Inserts therefore do not read a
 *    value back from the write; they insert with a known id and select by it
 *    (PORTABILITY rule 4).
 */

import { eq } from 'drizzle-orm';

import { newId } from '../../shared/db-values';
import type { Db } from '../db/index';

/**
 * Any Drizzle handle: the real `db`, a transaction, or the in-memory test
 * database.  Repositories take this rather than importing `db` themselves, so
 * a caller can run several repository calls inside one transaction.
 */
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>;

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} "${id}" not found`);
    this.name = 'NotFoundError';
  }
}

export { newId };

/**
 * Insert with an application-generated id, then read the row back by that id.
 *
 * Deliberately two statements rather than one `.returning()` call.  Drizzle
 * exposes `.returning()` on both drivers, but the underlying guarantees are not
 * the same — SQLite's `RETURNING` has documented interactions with triggers and
 * does not guarantee row order for multi-row statements, and code that grows to
 * depend on either is expensive to unpick later.  Since the id is known before
 * the insert, nothing is gained by reading it back from the write.
 */
export async function insertAndLoad<TTable extends { id: unknown }, TRow>(
  executor: Executor,
  table: TTable,
  idColumn: Parameters<typeof eq>[0],
  values: Record<string, unknown>,
  id: string,
): Promise<TRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (executor.insert as any)(table).values(values);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (executor.select as any)().from(table).where(eq(idColumn, id)).limit(1);
  const row = rows[0] as TRow | undefined;
  if (!row) throw new NotFoundError(String((table as { _?: { name?: string } })._?.name), id);
  return row;
}
