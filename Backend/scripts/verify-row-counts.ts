/**
 * Counts every table in the configured database.  `npm run db:verify`.
 *
 * Used on deployment day to compare SQLite against Supabase table by table
 * (see `scripts/migrate-to-supabase.md`).  Writes JSON to stdout when given
 * `--json`, so two runs can be diffed:
 *
 *   npm run db:verify -- --json > /tmp/before.json
 *   SUPABASE_DB_URL=... npm run db:verify -- --json > /tmp/after.json
 *   npx tsx scripts/verify-row-counts.ts --compare /tmp/before.json /tmp/after.json
 *
 * `count(*)` is identical in both dialects. It is the one raw fragment in the
 * codebase and it is isolated here, in a script, rather than in a route
 * handler (CLAUDE.md §2.1).
 */

import fs from 'node:fs';

import 'dotenv/config';
import { Table, getTableName, is } from 'drizzle-orm';

import { DB_DIALECT, db } from '../server/db/index';
import { countRows } from '../server/db/queries/count-rows';
import * as schema from '../server/db/schema/index';

interface TableRef {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
}

function allTables(): TableRef[] {
  const out: TableRef[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    out.push({ name: getTableName(value), table: value });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function countAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { name, table } of allTables()) {
    counts[name] = await countRows(db, table);
  }
  return counts;
}

function compare(beforePath: string, afterPath: string): void {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8')) as Record<string, number>;
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8')) as Record<string, number>;

  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const width = Math.max(...names.map((n) => n.length));
  let mismatches = 0;

  console.log(`${'table'.padEnd(width)}  ${'source'.padStart(8)}  ${'target'.padStart(8)}`);
  console.log('─'.repeat(width + 20));

  for (const name of names) {
    const a = before[name] ?? 0;
    const b = after[name] ?? 0;
    const ok = a === b;
    if (!ok) mismatches += 1;
    console.log(
      `${name.padEnd(width)}  ${String(a).padStart(8)}  ${String(b).padStart(8)}  ${ok ? '✓' : '✗ MISMATCH'}`,
    );
  }

  console.log('');
  if (mismatches > 0) {
    console.error(`✗ ${mismatches} table(s) differ. Do not cut over.`);
    process.exitCode = 1;
  } else {
    console.log(`✓ all ${names.length} tables match`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const compareIndex = args.indexOf('--compare');
  if (compareIndex !== -1) {
    const before = args[compareIndex + 1];
    const after = args[compareIndex + 2];
    if (!before || !after) {
      console.error('usage: --compare <before.json> <after.json>');
      process.exitCode = 1;
      return;
    }
    compare(before, after);
    return;
  }

  const counts = await countAll();

  if (args.includes('--json')) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }

  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  let total = 0;
  console.log(`▸ ${DB_DIALECT}\n`);
  for (const [name, n] of Object.entries(counts)) {
    total += n;
    console.log(`  ${name.padEnd(width)}  ${String(n).padStart(7)}`);
  }
  console.log(`\n  ${'TOTAL'.padEnd(width)}  ${String(total).padStart(7)} rows in ${Object.keys(counts).length} tables`);
}

main().catch((error: unknown) => {
  console.error('✗ verification failed:', error);
  process.exitCode = 1;
});
