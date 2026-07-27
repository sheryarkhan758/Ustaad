/**
 * Proves NFR-1: a filtered, ranked first page returns in under 500 ms against a
 * 500-tutor dataset.
 *
 *   npx tsx scripts/benchmark-search.ts
 *   npx tsx scripts/benchmark-search.ts --tutors 2000
 *
 * Runs against an in-memory database seeded with synthetic tutors, so it needs
 * no local.db and leaves nothing behind. Synthetic data only — this script must
 * never be pointed at real rows (CLAUDE.md §2.2).
 *
 * Reports the **95th percentile**, not the mean. A mean hides the tail, and the
 * budget is about what a family actually waits for, not what they wait for on
 * average.
 */

import { newId, nowIso } from '../shared/db-values';
import { normaliseHourlyAmount } from '../shared/rates';
import { searchQuerySchema, type SearchQuery } from '../shared/search';
import { createTestDb, type TestDb } from '../server/db/test-db';
import { seedReference } from '../server/db/seed/reference';
import { SEARCHABLE_PROFILE_STATUS, tutorAvailability, tutorProfiles, tutorRates, tutorSubjectClaims } from '../server/db/schema/tutor';
import { users } from '../server/db/schema/identity';
import { runAllMaterialisationJobs } from '../server/jobs/index';
import { searchTutors } from '../server/repositories/search';

const BUDGET_MS = 500;

const KARACHI_AREAS = [
  'karachi-gulshan-e-iqbal',
  'karachi-gulistan-e-johar',
  'karachi-dha',
  'karachi-clifton',
  'karachi-north-nazimabad',
  'karachi-nazimabad',
  'karachi-pechs',
  'karachi-saddar',
  'karachi-malir',
  'karachi-korangi',
];

const SUBJECTS = ['mathematics', 'physics', 'chemistry', 'biology', 'english'];
const LEVELS = ['matric', 'intermediate'];
const MODES = ['home', 'online', 'own_place'] as const;

const TOPICS = [
  'math-matric-sindh-quadratic-equations',
  'math-matric-sindh-algebraic-factorisation',
  'phy-matric-sindh-kinematics',
  'chem-matric-sindh-organic-chemistry',
  'bio-matric-sindh-cells-and-tissues',
];

/**
 * Deterministic pseudo-random, so two runs seed identical data and a timing
 * change means a code change rather than a different dataset.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

async function seedTutors(db: TestDb, count: number): Promise<void> {
  const random = makeRandom(42);
  const now = Date.now();

  const userRows: (typeof users.$inferInsert)[] = [];
  const profileRows: (typeof tutorProfiles.$inferInsert)[] = [];
  const rateRows: (typeof tutorRates.$inferInsert)[] = [];
  const claimRows: (typeof tutorSubjectClaims.$inferInsert)[] = [];
  const slotRows: (typeof tutorAvailability.$inferInsert)[] = [];

  for (let i = 0; i < count; i += 1) {
    const userId = newId();
    const tutorId = newId();
    const gender = random() < 0.55 ? 'female' : 'male';
    const areaCount = 1 + Math.floor(random() * 3);
    const areas = Array.from(
      new Set(
        Array.from({ length: areaCount }, () => KARACHI_AREAS[Math.floor(random() * KARACHI_AREAS.length)]!),
      ),
    );

    userRows.push({
      id: userId,
      email: `bench-tutor-${i}@example.invalid`,
      passwordHash: 'synthetic-benchmark-row',
      role: 'tutor',
      displayName: `Benchmark Tutor ${i}`,
      gender,
      status: 'active',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    profileRows.push({
      id: tutorId,
      userId,
      gender,
      cityId: 'karachi',
      slug: `bench-tutor-${i}`,
      // 90% approved, so the searchable predicate has real work to do.
      profileStatus: random() < 0.9 ? SEARCHABLE_PROFILE_STATUS : 'pending_verification',
      teachesAtHome: random() < 0.7 ? 1 : 0,
      teachesOnline: random() < 0.5 ? 1 : 0,
      teachesAtOwnPlace: random() < 0.3 ? 1 : 0,
      volunteerFlag: random() < 0.08 ? 1 : 0,
      experienceYears: Math.floor(random() * 20),
      willingAreasJson: JSON.stringify(areas),
      createdAt: new Date(now - Math.floor(random() * 400) * 86_400_000).toISOString(),
    });

    // Two or three rates each, across the §6.5 shapes.
    const rateCount = 2 + Math.floor(random() * 2);
    for (let r = 0; r < rateCount; r += 1) {
      const subjectId = SUBJECTS[Math.floor(random() * SUBJECTS.length)]!;
      const levelId = LEVELS[Math.floor(random() * LEVELS.length)]!;
      const mode = MODES[Math.floor(random() * MODES.length)]!;
      const amount = 400_000 + Math.floor(random() * 1_600_000);
      const sessionsPerWeek = 2 + Math.floor(random() * 3);
      const minutesPerSession = [60, 90, 120][Math.floor(random() * 3)]!;

      rateRows.push({
        id: newId(),
        tutorId,
        subjectId,
        levelId,
        rateType: 'monthly',
        amount,
        currency: 'PKR',
        sessionsPerWeek,
        minutesPerSession,
        mode,
        negotiable: random() < 0.4 ? 1 : 0,
        travelCharge: mode === 'online' ? 0 : Math.floor(random() * 60_000),
        normalisedHourlyAmount: normaliseHourlyAmount({
          rateType: 'monthly',
          amount,
          sessionsPerWeek,
          minutesPerSession,
        }),
        createdAt: nowIso(),
      });
    }

    // One claim, sometimes assessed.
    const verified = random() < 0.45;
    claimRows.push({
      id: newId(),
      tutorId,
      subjectId: SUBJECTS[Math.floor(random() * SUBJECTS.length)]!,
      levelId: LEVELS[Math.floor(random() * LEVELS.length)]!,
      boardId: 'sindh-board',
      topicIdsJson: JSON.stringify([
        TOPICS[Math.floor(random() * TOPICS.length)]!,
        'math-matric-sindh-quadratic-equations',
      ]),
      claimStatus: verified ? 'verified' : 'asserted',
      verifiedAt: verified ? nowIso() : null,
      expiresOn: verified ? '2027-12-31' : null,
      verifiedScore: verified ? 60 + Math.floor(random() * 40) : null,
      appealCount: 0,
      createdAt: nowIso(),
    });

    // Three weekdays each, so the availability filter narrows without
    // emptying the set — a scenario that returns nothing does not exercise
    // the ranking loop, and the ranking loop is what the budget is about.
    const weekdays = new Set<number>();
    while (weekdays.size < 3) weekdays.add(Math.floor(random() * 7));
    for (const weekday of weekdays) {
      slotRows.push({
        id: newId(),
        tutorId,
        weekday,
        startTime: '15:00',
        endTime: '21:00',
        mode: 'home',
        areaId: areas[0]!,
        createdAt: nowIso(),
      });
    }
  }

  // Chunked, because SQLite caps bound parameters per statement.
  const chunk = <T,>(rows: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) =>
      rows.slice(i * size, i * size + size),
    );

  for (const batch of chunk(userRows, 100)) await db.insert(users).values(batch);
  for (const batch of chunk(profileRows, 100)) await db.insert(tutorProfiles).values(batch);
  for (const batch of chunk(rateRows, 100)) await db.insert(tutorRates).values(batch);
  for (const batch of chunk(claimRows, 100)) await db.insert(tutorSubjectClaims).values(batch);
  for (const batch of chunk(slotRows, 100)) await db.insert(tutorAvailability).values(batch);
}

interface Scenario {
  name: string;
  query: Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  { name: 'unfiltered, ranked first page', query: {} },
  { name: 'city + mode', query: { cityId: 'karachi', mode: 'home' } },
  {
    name: 'the restricted-mobility pathway (§2.1)',
    query: {
      cityId: 'karachi',
      areaId: 'karachi-gulshan-e-iqbal',
      genderPreference: 'female_only',
      mode: 'home',
    },
  },
  {
    name: 'full filter set, adjacent areas, topic + price',
    query: {
      subjectId: 'mathematics',
      levelId: 'matric',
      boardId: 'sindh-board',
      topicIds: ['math-matric-sindh-quadratic-equations'],
      cityId: 'karachi',
      areaId: 'karachi-gulshan-e-iqbal',
      includeAdjacentAreas: true,
      mode: 'home',
      genderPreference: 'female_only',
      maxHourlyRate: 120_000,
      availableWeekday: 1,
      availableFrom: '16:00',
      availableTo: '18:00',
    },
  },
];

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index]!;
}

async function main(): Promise<void> {
  const arg = process.argv.indexOf('--tutors');
  const tutorCount = arg !== -1 ? Number(process.argv[arg + 1]) : 500;

  console.log('');
  console.log('═'.repeat(74));
  console.log(`  Search performance — NFR-1: under ${BUDGET_MS} ms on a 500-tutor dataset`);
  console.log('═'.repeat(74));
  console.log('');

  const db = createTestDb();
  await seedReference(db as unknown as Parameters<typeof seedReference>[0]);

  process.stdout.write(`  seeding ${tutorCount} synthetic tutors… `);
  const seedStart = performance.now();
  await seedTutors(db, tutorCount);
  console.log(`${Math.round(performance.now() - seedStart)} ms`);

  process.stdout.write('  running materialisation jobs…      ');
  const jobs = await runAllMaterialisationJobs(db);
  console.log(`${jobs.totalMs} ms`);
  console.log(
    `    tutor_scores ${jobs.scores.topicRows} rows · tutor_reliability ${jobs.reliability.written} rows · ` +
      `rate_benchmarks ${jobs.benchmarks.published} published / ${jobs.benchmarks.suppressed} suppressed`,
  );
  console.log('');

  const WARMUP = 5;
  const RUNS = 30;
  let worst = 0;
  let failed = false;

  for (const scenario of SCENARIOS) {
    const query: SearchQuery = searchQuerySchema.parse(scenario.query);

    for (let i = 0; i < WARMUP; i += 1) await searchTutors(db, query);

    const timings: number[] = [];
    let resultCount = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now();
      const response = await searchTutors(db, query);
      timings.push(performance.now() - started);
      resultCount = response.total;
    }

    timings.sort((a, b) => a - b);
    const p50 = percentile(timings, 0.5);
    const p95 = percentile(timings, 0.95);
    const max = timings[timings.length - 1]!;
    worst = Math.max(worst, p95);

    const ok = p95 < BUDGET_MS;
    if (!ok) failed = true;

    console.log(`  ${ok ? '✓' : '✗'} ${scenario.name}`);
    console.log(
      `      p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms · max ${max.toFixed(2)} ms ` +
        `· ${resultCount} matching tutor(s)`,
    );
  }

  console.log('');
  console.log('─'.repeat(74));
  console.log(
    `  Worst p95 across all scenarios: ${worst.toFixed(2)} ms  (budget ${BUDGET_MS} ms)  ` +
      `${failed ? '✗ OVER BUDGET' : '✓ within budget'}`,
  );
  console.log('');
  console.log('  Measured on this machine, against an in-memory SQLite database with');
  console.log('  synthetic data. Every ranking input is read from a materialised table;');
  console.log('  no aggregate is computed and no model is called in the request path.');
  console.log('');

  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('✗ benchmark failed:', error);
  process.exitCode = 1;
});
