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

/**
 * The Postgres connection string, from whichever variable the host provides.
 *
 * `SUPABASE_DB_URL` remains the documented name. The alternatives exist
 * because a Postgres URL is a Postgres URL — a managed database provisioned
 * from the Netlify UI sets `NETLIFY_DATABASE_URL` and cannot be told to call
 * itself something else, and refusing to read it would mean the application
 * could not use a database that is sitting right there and correctly
 * configured.
 *
 * `DATABASE_URL` is accepted **only** when it names Postgres. In local
 * development it holds `file:./local.db`, and treating that as a connection
 * string would send the driver looking for a server that does not exist.
 *
 * Resolution order is deliberate: an explicitly-set `SUPABASE_DB_URL` wins, so
 * a host that injects its own variable can never silently override the one a
 * person chose.
 */
function resolvePostgresUrl(): string | undefined {
  const explicit = clean(process.env.SUPABASE_DB_URL, 'SUPABASE_DB_URL');
  if (explicit) return explicit;

  const netlify = clean(process.env.NETLIFY_DATABASE_URL, 'NETLIFY_DATABASE_URL');
  if (netlify) return netlify;

  const generic = clean(process.env.DATABASE_URL, 'DATABASE_URL', { quiet: true });
  if (generic && /^postgres(ql)?:\/\//i.test(generic)) return generic;

  return undefined;
}

/**
 * Trim a connection string, drop quotes somebody pasted with it, and refuse a
 * value the driver cannot parse — by name, in one sentence.
 *
 * A value pasted into a hosting dashboard arrives however the clipboard left
 * it. Wrapping quotes or backticks survive `.trim()`, and postgres-js then
 * fails inside `new URL()` with `TypeError: Invalid URL` — a message that names
 * neither the variable nor the mistake, and which a visitor sees as a 502 on
 * every page. Stripping the quotes fixes the common paste; anything still
 * unparseable is reported here, where the name of the variable is known.
 *
 * **The value itself is never in the message.** It carries a database password
 * (§2.2), and an error that echoed it would put that password in the function
 * log and on the screen of whoever hit the page.
 */
function clean(raw: string | undefined, name: string, options: { quiet?: boolean } = {}): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const unquoted = /^(["'`])(.*)\1$/s.exec(trimmed)?.[2]?.trim() ?? trimmed;
  if (!unquoted) return undefined;

  // `DATABASE_URL` legitimately holds `file:./local.db` in development, so it
  // is checked for the Postgres scheme by the caller instead of rejected here.
  if (options.quiet) return unquoted;

  try {
    new URL(unquoted);
  } catch {
    throw new Error(
      `${name} is set but is not a valid connection string, so no database can be opened. ` +
        'Check it against the string in DEPLOY.md step 2: it starts with "postgresql://", ' +
        'carries no surrounding quotes and no line break, and any of + ? # / @ in the ' +
        `password must be percent-encoded (+ is %2B, ? is %3F). ${describe(unquoted)} ` +
        'The value itself is not shown: it contains the database password.',
    );
  }
  return unquoted;
}

/**
 * What is wrong with the string, said without saying the string.
 *
 * Diagnosing a bad paste otherwise means asking somebody to read a secret back
 * to you. These are structural facts — a length, a scheme, the presence of a
 * character that cannot appear unencoded — and none of them narrows the
 * password, because everything after the scheme is summarised rather than
 * quoted. The three faults named are the three that actually happen: the
 * dashboard's `[YOUR-PASSWORD]` placeholder left in place, a copied `psql`
 * command rather than its argument, and a raw space.
 */
function describe(value: string): string {
  const faults: string[] = [];
  if (value.includes('[') || value.includes(']')) {
    faults.push('it still contains [ ] — the dashboard placeholder was not replaced with the password');
  }
  if (/^psql\b/i.test(value)) faults.push('it begins "psql", so a whole command was pasted instead of the URL it takes');
  if (/\s/.test(value)) faults.push('it contains a space');
  if (!/^postgres(ql)?:\/\//i.test(value)) faults.push('it does not begin "postgresql://"');

  const shape = `What is set is ${value.length} characters long`;
  return faults.length > 0 ? `${shape}, and ${faults.join(', and ')}.` : `${shape}.`;
}

/**
 * Set in production only. Its presence *is* the switch.
 *
 * Exported so that everything which needs to know "is this a real database?"
 * asks **this** rather than re-reading an environment variable. The demo seed
 * guard depends on it: a check written against one variable name stops working
 * the moment a second one is accepted, and that particular check is what keeps
 * invented people with a published password out of production (FR-15.9).
 */
export const POSTGRES_URL: string | undefined = resolvePostgresUrl();

export const DB_DIALECT: DbDialect = POSTGRES_URL ? 'postgres' : 'sqlite';

/** `file:./local.db` → `./local.db`.  better-sqlite3 takes a bare path. */
function sqlitePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./local.db';
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

/**
 * Refuse SQLite where it cannot work — and say so in one sentence.
 *
 * A serverless function has an ephemeral filesystem and no compiler, so
 * `better-sqlite3` there fails on a missing GLIBC symbol while loading its
 * native binary. That error names a shared library and a `.node` file and
 * says nothing whatsoever about the actual mistake, which is that
 * `SUPABASE_DB_URL` was never set on the deployment.
 *
 * Detecting the platform rather than trusting `NODE_ENV`: `NETLIFY` and
 * `AWS_LAMBDA_FUNCTION_NAME` are set by the runtime itself and cannot be
 * forgotten the way an environment variable can.
 */
function assertSqliteIsUsableHere(): void {
  const serverless = Boolean(
    process.env.NETLIFY ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? process.env.LAMBDA_TASK_ROOT,
  );
  if (!serverless) return;

  throw new Error(
    'No Postgres connection string is set, so the server tried to open a local SQLite ' +
      'file — which cannot work in a serverless function: the filesystem is ' +
      'ephemeral and the native driver has no binary for this runtime. Set ' +
      'SUPABASE_DB_URL (or NETLIFY_DATABASE_URL, which a Netlify-provisioned ' +
      'database sets for you) in the site environment variables and redeploy. ' +
      'See DEPLOY.md step 3.',
  );
}

function openSqlite() {
  assertSqliteIsUsableHere();

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

const rawDb = POSTGRES_URL ? openPostgres(POSTGRES_URL) : openSqlite();

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
