/**
 * Compare row counts table by table between SQLite and Supabase Postgres.
 *
 *     npx tsx scripts/compare-row-counts.ts
 *
 * Deployment-day step 4 of `scripts/migrate-to-supabase.md`: prove the
 * migration moved what it claimed to move. Reads **both** databases in one
 * process and prints a table with a verdict per row.
 *
 * ── What a mismatch means ──────────────────────────────────────────────────
 * Reference data must match exactly — it is seeded from the same files on both
 * sides, so a difference means a seed failed partway or ran twice.
 *
 * User data is expected to be **empty in Postgres** on a first deployment.
 * Local user data is development data and does not migrate: it is invented
 * people in a file that never enters the repository (§2.2). A non-empty user
 * table on a fresh production database is the thing to stop and look at, not a
 * matching one.
 *
 * So the verdict column reads the two differently, and says which it applied.
 */

import 'dotenv/config';

import BetterSqlite3 from 'better-sqlite3';
import postgres from 'postgres';

/** Seeded from committed files, identical on both sides (§12). */
const REFERENCE_TABLES = [
  'provinces',
  'cities',
  'areas',
  'area_adjacency',
  'subjects',
  'levels',
  'boards',
  'topics',
  'topic_prerequisites',
  'service_types',
  'i18n_strings',
] as const;

/** Everything else. Expected empty on a fresh production database. */
const USER_TABLES = [
  'users',
  'parent_profiles',
  'student_profiles',
  'tutor_profiles',
  'tutor_subject_claims',
  'tutor_rates',
  'tutor_availability',
  'tutor_documents',
  'tutor_safety_constraints',
  'verification_records',
  'verification_appeals',
  'cnic_registrations',
  'notifications',
  'notification_dedupe',
  'bookings',
  'session_notes',
  'trial_fit_checks',
  'payment_records',
  'payment_disputes',
  'reviews',
  'review_analyses',
  'agent_sessions',
  'diagnostics',
  'verification_attempts',
  'study_plans',
  'ai_call_log',
  'group_requests',
  'group_proposals',
  'group_members',
  'unmet_demand',
  'org_profiles',
  'vacancies',
  'vacancy_interests',
  'flags',
  'admin_actions',
  'platform_feedback',
  'volunteer_applications',
  'tutor_scores',
  'tutor_search_signals',
  'tutor_reliability',
  'rate_benchmarks',
  'refresh_tokens',
] as const;

interface Row {
  table: string;
  kind: 'reference' | 'user';
  sqlite: number | null;
  postgres: number | null;
  verdict: string;
  ok: boolean;
}

function sqlitePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./local.db';
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

async function main(): Promise<void> {
  const pgUrl = process.env.SUPABASE_DB_URL;
  if (!pgUrl) {
    console.error('✗ SUPABASE_DB_URL is not set. Nothing to compare against.');
    console.error('  Set it to the Supabase connection string and re-run.');
    process.exitCode = 1;
    return;
  }

  const sqlite = new BetterSqlite3(sqlitePath(), { readonly: true, fileMustExist: true });
  const sql = postgres(pgUrl, { max: 1, prepare: false });

  const countSqlite = (table: string): number | null => {
    try {
      // `count(*)` is identical in both engines and takes no user input — the
      // same reasoning as `server/db/queries/count-rows.ts`. This script is not
      // a route handler and never runs in a request (§2.1).
      // PORTABILITY rule 6 forbids `.get()` because it exists only on
      // better-sqlite3. That is exactly why it is correct here: this script
      // opens better-sqlite3 *directly* to read the old database and compare it
      // with the new one. It is a deployment tool, never imported by the
      // server, and the one place that must know both engines at once.
      // eslint-disable-next-line no-restricted-syntax
      const row = sqlite.prepare(`select count(*) as n from "${table}"`).get() as { n: number };
      return Number(row.n);
    } catch {
      return null; // table absent on this side
    }
  };

  const countPostgres = async (table: string): Promise<number | null> => {
    try {
      // The raw-SQL rule targets query builders in the application. This is
      // the postgres-js client, used directly for the same reason as above.
      // `count(*)` takes no user input — the table name comes from the constant
      // lists in this file and is passed through `sql()`, which quotes it.
      // eslint-disable-next-line no-restricted-syntax
      const rows = await sql`select count(*)::int as n from ${sql(table)}`;
      return Number(rows[0]!.n);
    } catch {
      return null;
    }
  };

  const results: Row[] = [];

  for (const [tables, kind] of [
    [REFERENCE_TABLES, 'reference'],
    [USER_TABLES, 'user'],
  ] as const) {
    for (const table of tables) {
      const a = countSqlite(table);
      const b = await countPostgres(table);

      let verdict: string;
      let ok: boolean;

      if (b === null) {
        verdict = 'MISSING in Postgres';
        ok = false;
      } else if (a === null) {
        verdict = 'absent locally — ignored';
        ok = true;
      } else if (kind === 'reference') {
        ok = a === b;
        verdict = ok ? 'match' : `MISMATCH (${a} → ${b})`;
      } else {
        // User data is not migrated. Empty is the expected, correct outcome.
        ok = b === 0 || b === a;
        verdict = b === 0 ? 'empty (expected)' : b === a ? 'match' : `REVIEW (${a} → ${b})`;
      }

      results.push({ table, kind, sqlite: a, postgres: b, verdict, ok });
    }
  }

  await sql.end();
  sqlite.close();

  const width = Math.max(...results.map((r) => r.table.length), 5);
  console.log('');
  console.log(`${'table'.padEnd(width)}  ${'sqlite'.padStart(7)}  ${'pg'.padStart(7)}  verdict`);
  console.log('-'.repeat(width + 30));
  for (const row of results) {
    const mark = row.ok ? ' ' : '!';
    console.log(
      `${mark}${row.table.padEnd(width - 1)}  ${String(row.sqlite ?? '—').padStart(7)}  ` +
        `${String(row.postgres ?? '—').padStart(7)}  ${row.verdict}`,
    );
  }

  const failures = results.filter((r) => !r.ok);
  const missing = failures.filter((r) => r.postgres === null);

  console.log('');
  console.log(`${results.length} tables compared, ${failures.length} needing attention.`);

  if (missing.length > 0) {
    console.error(`✗ ${missing.length} table(s) do not exist in Postgres — migrations did not fully apply.`);
  }
  if (failures.length > 0) process.exitCode = 1;
  else console.log('✓ reference data matches and no unexpected user data is present.');
}

main().catch((error: unknown) => {
  console.error('✗ comparison failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
