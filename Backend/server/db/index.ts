/**
 * The single database access point.
 *
 * **One file, two dialects, selected by one environment variable.**  Set
 * `SUPABASE_DB_URL` and the process talks to Supabase Postgres; leave it unset
 * and it talks to the local SQLite file.  Nothing else in the codebase imports
 * `better-sqlite3` or `postgres`, and nothing else knows which engine is
 * running (specification §10.1, §10.2).
 *
 * Two things make that switch a configuration change rather than a rewrite:
 *
 *  1. **The schema is portable.**  Every column is `text`, `integer` or `real`
 *     — the three builders whose signatures and semantics are identical in
 *     `sqlite-core` and `pg-core`.  `server/db/schema-pg/` is therefore
 *     *generated* from `server/db/schema/` by swapping one import line per file
 *     (`scripts/generate-pg-schema.ts`), and a test fails if it drifts.  The
 *     rules that keep it that way are in `server/db/PORTABILITY.md`.
 *  2. **Queries go through repositories.**  Route handlers never touch `db`.
 *     `server/repositories/` is the only layer that builds queries, so the set
 *     of SQL this application can emit is small, reviewed, and known to run on
 *     both engines.
 *
 * ── On the type of `db` ────────────────────────────────────────────────────
 * `BetterSQLite3Database` and `PostgresJsDatabase` are distinct types, so the
 * Postgres branch is cast to the SQLite one and `Db` is declared from it.  That
 * cast is not papering over a difference — it is sound *because* of rule (1):
 * the two schemas declare identical column types, so `$inferSelect` and
 * `$inferInsert` produce identical row shapes on both sides.  If a future
 * column breaks that, `npx tsx scripts/generate-pg-schema.ts --check` fails
 * first, which is where the problem should surface.
 */

import 'dotenv/config';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as pgSchema from './schema-pg/index';
import * as schema from './schema/index';
import { guardAdminActionsWrites } from './runtime-guards';

export type DbDialect = 'sqlite' | 'postgres';

/** Set in production only.  Its presence *is* the switch. */
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

export const DB_DIALECT: DbDialect = SUPABASE_DB_URL ? 'postgres' : 'sqlite';

/** `file:./local.db` → `./local.db`.  better-sqlite3 takes a bare path. */
function sqlitePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./local.db';
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

function openSqlite() {
  const connection = new BetterSqlite3(sqlitePath());

  // Connection settings, not schema or query semantics. SQLite ships with
  // foreign keys OFF and Postgres cannot turn them off, so this pragma is what
  // makes the two engines agree. WAL is a local durability setting. These are
  // the only pragmas in the codebase, and they live here because this is the
  // only file that knows an engine is involved at all.
  connection.pragma('foreign_keys = ON');
  connection.pragma('journal_mode = WAL');

  return drizzleSqlite(connection, { schema });
}

function openPostgres(url: string) {
  // `prepare: false` suits Supabase's transaction-mode connection pooler, which
  // does not hold a session across statements. `max` is deliberately small: a
  // serverless function opens connections unpredictably (§10.2).
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 5),
    prepare: false,
  });

  // Sound because both schemas declare identical column types — see the note
  // at the top of this file.
  return drizzlePg(client, { schema: pgSchema }) as unknown as BetterSQLite3Database<
    typeof schema
  >;
}

const rawDb = SUPABASE_DB_URL ? openPostgres(SUPABASE_DB_URL) : openSqlite();

export const db = guardAdminActionsWrites(rawDb);

export type Db = typeof db;

/**
 * ── On transactions ────────────────────────────────────────────────────────
 * There is deliberately **no** `withTransaction` helper here.
 *
 * Drizzle's transaction callback is synchronous on better-sqlite3 and
 * asynchronous on postgres-js, and every statement in this codebase is awaited
 * (PORTABILITY.md rule 6). A wrapper spanning both would either have to branch
 * on the dialect in every caller, or be a no-op that claims atomicity it does
 * not provide — and a helper named `withTransaction` that does not open one is
 * worse than none, because the next reader stops checking.
 *
 * Where two writes must not half-happen, the guarantee is expressed in the
 * schema instead: a unique constraint decides the winner and a compensating
 * delete cleans up the loser. `server/services/booking-create.ts` is the
 * worked example — `booking_slot_reservations` carries the unique index that
 * makes concurrent booking requests resolve to exactly one.
 */

export { schema, pgSchema };
