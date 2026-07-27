/**
 * Generates `server/db/schema-pg/` from `server/db/schema/`.
 *
 *   npx tsx scripts/generate-pg-schema.ts
 *   npx tsx scripts/generate-pg-schema.ts --check    # CI / test mode
 *
 * The transform is three string replacements, and that is the whole point.
 *
 * Drizzle's table builders are dialect-specific — there is no `table()` that
 * serves both — so a project targeting two engines maintains two schema trees.
 * The cost of that is normally high and grows with every column. It is low here
 * because of the rules in `server/db/PORTABILITY.md`: every column is `text`,
 * `integer` or `real`, and those three builders have identical signatures and
 * identical semantics in `drizzle-orm/sqlite-core` and `drizzle-orm/pg-core`.
 *
 * So the Postgres schema is not hand-maintained and cannot drift. It is
 * derived, checked in, and verified by `server/db/schema-drift.test.ts`.
 *
 * If a future edit introduces a column type that needs more than this
 * transform, the `--check` run fails and that is the signal to reconsider the
 * column rather than to hand-patch the output.
 */

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DIR = 'server/db/schema';
const TARGET_DIR = 'server/db/schema-pg';

const BANNER = `// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/%FILE% by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────
`;

/** Column builders that mean different things in the two dialects. */
const FORBIDDEN = [
  { pattern: /mode:\s*'boolean'/, rule: 'rule 2 — booleans are integer 0/1 via boolCol()' },
  { pattern: /mode:\s*'json'/, rule: 'rule 3 — JSON is text via jsonCol()' },
  { pattern: /mode:\s*'timestamp(_ms)?'/, rule: 'rule 1 — timestamps are ISO-8601 text' },
  { pattern: /\bblob\(/, rule: 'blob has no portable Postgres equivalent' },
  { pattern: /\bnumeric\(/, rule: 'numeric differs between engines; money is integer paisa' },
  { pattern: /\bbigint\(/, rule: 'bigint is not available in sqlite-core' },
  { pattern: /\.autoincrement\(/, rule: 'rule 5 — ids are generated in application code' },
];

/** Comments name the forbidden constructs in order to explain them; only code counts. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export function transform(source: string, fileName: string): string {
  const code = stripComments(source);
  for (const { pattern, rule } of FORBIDDEN) {
    if (pattern.test(code)) {
      throw new Error(
        `${SOURCE_DIR}/${fileName} uses ${pattern.source}, which is not portable.\n` +
          `  See server/db/PORTABILITY.md, ${rule}.`,
      );
    }
  }

  const out = source
    .replace(/from 'drizzle-orm\/sqlite-core'/g, "from 'drizzle-orm/pg-core'")
    .replace(/\bsqliteTable\b/g, 'pgTable')
    // shared/ is three levels up from schema-pg/, exactly as from schema/.
    .replace(/'\.\.\/\.\.\/\.\.\/shared\//g, "'../../../shared/");

  return BANNER.replace('%FILE%', fileName) + '\n' + out;
}

function main(): void {
  const check = process.argv.includes('--check');
  const files = fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts'));

  if (!check) fs.mkdirSync(TARGET_DIR, { recursive: true });

  const stale: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    const generated = transform(source, file);
    const target = path.join(TARGET_DIR, file);

    if (check) {
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (existing !== generated) stale.push(file);
    } else {
      fs.writeFileSync(target, generated, 'utf8');
      console.log(`  ${TARGET_DIR}/${file}`);
    }
  }

  if (check) {
    if (stale.length > 0) {
      console.error('✗ Postgres schema is stale for:');
      for (const f of stale) console.error(`    ${f}`);
      console.error('\nRun:  npx tsx scripts/generate-pg-schema.ts');
      process.exitCode = 1;
      return;
    }
    console.log('✓ Postgres schema is in sync with the SQLite schema');
    return;
  }

  console.log(`✓ generated ${files.length} file(s) into ${TARGET_DIR}`);
}

// Only run when invoked directly, so the drift test can import `transform`.
if (process.argv[1]?.includes('generate-pg-schema')) main();
