/**
 * Seed runner.  `npm run db:seed`.
 *
 * Only reference data is seeded here.  Reference data is static, contains no
 * user information, and is committed to the repository (§12).  Demonstration
 * user data — tutors, parents, bookings — is generated separately and is never
 * committed (CLAUDE.md §2.2).
 *
 * The summary counts rows **read back out of the database**, not the length of
 * the seed constants, and the run fails if the two disagree.  An earlier
 * version printed the constants: when a refactor made the writes silently
 * no-op, the output was still a clean list of expected numbers.  A verification
 * step that cannot fail is not a verification step.
 */

import 'dotenv/config';

import { db } from '../index';
import { countRows } from '../queries/count-rows';
import {
  areaAdjacency,
  areas,
  boards,
  cities,
  i18nStrings,
  levels,
  provinces,
  serviceTypes,
  subjects,
  topicPrerequisites,
  topics,
} from '../schema/reference';
import { REFERENCE_COUNTS, seedReference } from './reference';
import { SeedValidationError } from './validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLES: Record<string, any> = {
  provinces,
  cities,
  areas,
  area_adjacency: areaAdjacency,
  subjects,
  levels,
  boards,
  topics,
  topic_prerequisites: topicPrerequisites,
  service_types: serviceTypes,
  i18n_strings: i18nStrings,
};

async function main(): Promise<void> {
  console.log('▸ validating reference data');
  console.log('▸ seeding reference data');

  await seedReference(db);

  const expected = REFERENCE_COUNTS();
  const width = Math.max(...Object.keys(expected).map((k) => k.length));
  const mismatches: string[] = [];

  for (const [name, table] of Object.entries(TABLES)) {
    const actual = await countRows(db, table);
    const want = expected[name as keyof typeof expected];
    const ok = actual === want;
    if (!ok) mismatches.push(`${name}: expected ${want}, found ${actual}`);
    console.log(`  ${name.padEnd(width)}  ${String(actual).padStart(5)}${ok ? '' : `  ✗ expected ${want}`}`);
  }

  if (mismatches.length > 0) {
    throw new Error(`seed wrote unexpected row counts:\n  ${mismatches.join('\n  ')}`);
  }

  console.log('✓ reference data seeded and verified against the database');
}

main().catch((error: unknown) => {
  if (error instanceof SeedValidationError) {
    console.error(`\n✗ ${error.message}\n`);
    console.error('No rows were written. Fix server/db/seed/reference.ts and run again.');
  } else {
    console.error('\n✗ seed failed:', error);
  }
  process.exitCode = 1;
});
