/**
 * The demonstration path — §6.15, FR-15.1 to FR-15.8.
 *
 * The claim being tested is narrow and load-bearing: **the demonstration works
 * with every AI key removed from the environment.** §15's risk table names a
 * free-tier rate limit reached during assessment as a live risk, and the answer
 * is not "it usually works" — it is that the demonstration routes reach no
 * provider at all.
 *
 * So `beforeAll` deletes the keys outright. If any of these tests ever needs
 * one, the guarantee has been lost.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app';
import { seedDemoData } from './db/seed/demo/index';
import { createSeededTestDb, type TestDb } from './db/test-db';
import type { Executor } from './repositories/_base';

let db: TestDb;
let app: ReturnType<typeof createApp>;

const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['GEMINI_API_KEY', 'GROQ_API_KEY']) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  db = await createSeededTestDb();
  app = createApp(db);
  await seedDemoData(db as unknown as Executor, new Date('2026-07-27T00:00:00.000Z'));
});

/* =========================================================================
 * The seed itself — FR-15.8
 * ====================================================================== */

describe('the demonstration seed', () => {
  it('produces at least 25 tutors across at least four cities', async () => {
    const { tutorProfiles } = await import('./db/schema/tutor');
    const rows = await db.select().from(tutorProfiles);

    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(new Set(rows.map((r) => r.cityId)).size).toBeGreaterThanOrEqual(4);
  });

  it('covers every verification state an administrator has to handle', async () => {
    const { tutorProfiles } = await import('./db/schema/tutor');
    const statuses = new Set((await db.select().from(tutorProfiles)).map((r) => r.profileStatus));

    // Approved, awaiting a decision, documents awaiting review, rejected and
    // more-info-needed all have to be present or the admin queue is a stub.
    for (const status of ['approved', 'pending_verification', 'documents_submitted', 'rejected', 'more_info_needed']) {
      expect(statuses, `no tutor in state "${status}"`).toContain(status);
    }
  });

  it('leaves the primary use case non-empty — a female home tutor in a Karachi area', async () => {
    // FR-15.6, and the reason the cohort is deliberately unbalanced: an empty
    // result here disproves the product in front of the person assessing it.
    const res = await request(app).get(
      '/api/search?genderPreference=female_only&mode=home&areaId=karachi-clifton',
    );

    expect(res.status).toBe(200);
    const results = res.body.results ?? res.body.items ?? [];
    expect(results.length).toBeGreaterThanOrEqual(4);
    // The hard filter is a hard filter, in the seeded data as everywhere else.
    expect(results.every((r: { gender: string }) => r.gender === 'female')).toBe(true);
  });

  it('runs the materialisation jobs, so no derived statistic is empty', async () => {
    const { tutorScores, rateBenchmarks } = await import('./db/schema/derived');

    expect((await db.select().from(tutorScores)).length).toBeGreaterThan(0);
    // Rate benchmarks suppress cohorts below four (SEC-17), so a published row
    // means a real cohort formed rather than the threshold being ignored.
    const benchmarks = await db.select().from(rateBenchmarks);
    expect(benchmarks.length).toBeGreaterThan(0);
    expect(benchmarks.some((b) => b.published === 1)).toBe(true);
  });

  it('holds every student under 18 as a parent-owned profile with no account', async () => {
    const { studentProfiles, users } = await import('./db/schema/identity');
    const students = await db.select().from(studentProfiles);
    const accounts = new Set((await db.select().from(users)).map((u) => u.id));

    const minors = students.filter(
      (s) => s.dateOfBirth !== null && new Date(s.dateOfBirth) > new Date('2008-07-27'),
    );
    expect(minors.length).toBeGreaterThan(0);

    for (const minor of minors) {
      // A minor is owned by a parent and has no account of their own (SEC-1).
      expect(minor.parentUserId, `${minor.name} has no owning parent`).toBeTruthy();
      expect(minor.selfUserId, `${minor.name} has an account`).toBeNull();
      expect(accounts.has(minor.id)).toBe(false);
    }
  });

  it('is idempotent — re-seeding does not duplicate or fail', async () => {
    const { users } = await import('./db/schema/identity');
    const before = (await db.select().from(users)).length;

    // The audit log pins the users it names, so the second run must reuse them
    // rather than delete and reinsert.
    await seedDemoData(db as unknown as Executor, new Date('2026-07-27T00:00:00.000Z'));

    expect((await db.select().from(users)).length).toBe(before);
  });

  it('seeds reviews whose credibility signals actually differ (FR-15.3)', async () => {
    const { reviewAnalyses } = await import('./db/schema/feedback');
    const rows = await db.select().from(reviewAnalyses);

    expect(rows.some((r) => r.genericFlag === 1)).toBe(true);
    expect(rows.some((r) => r.contradictionFlag === 1)).toBe(true);
    expect(rows.some((r) => r.safetyConcernFlag === 1)).toBe(true);
    // A generic review is down-weighted, never hidden (FR-9.6).
    const generic = rows.find((r) => r.genericFlag === 1)!;
    expect(generic.credibilityWeight).toBeLessThan(1);
  });

  it('keeps the safety-flagged review out of the public listing (SEC-9)', async () => {
    const { reviews, reviewAnalyses } = await import('./db/schema/feedback');
    const flagged = (await db.select().from(reviewAnalyses)).find((r) => r.safetyConcernFlag === 1)!;
    const review = (await db.select().from(reviews)).find((r) => r.id === flagged.reviewId)!;

    const res = await request(app).get(`/api/reviews/tutor/${review.tutorId}`);
    expect(res.status).toBe(200);
    const ids = (res.body.items ?? []).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(review.id);
  });
});

/* =========================================================================
 * Replay — FR-15.1, FR-15.7
 * ====================================================================== */

describe('demonstration replay makes no live model call', () => {
  it('serves five scenarios with no login at all (FR-15.1)', async () => {
    const res = await request(app).get('/api/demo/scenarios');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.replay.liveModelCalls).toBe(0);

    // Each of FR-15.2 to FR-15.6 has a scenario.
    const requirements = res.body.items.map((i: { requirement: string }) => i.requirement).sort();
    expect(requirements).toEqual(['FR-15.2', 'FR-15.3', 'FR-15.4', 'FR-15.5', 'FR-15.6']);
  });

  it('replays the diagnostic scenario turn by turn', async () => {
    const scenario = await request(app).get('/api/demo/scenarios/diagnostic-root-gap');
    expect(scenario.status).toBe(200);
    expect(scenario.body.scenario.totalTurns).toBeGreaterThan(1);

    const seen: string[] = [];
    for (let i = 0; i < scenario.body.scenario.totalTurns; i += 1) {
      const turn = await request(app).get(`/api/demo/scenarios/diagnostic-root-gap/turns/${i}`);
      expect(turn.status).toBe(200);
      expect(turn.body.liveModelCalls).toBe(0);
      seen.push(turn.body.turn.text);
    }

    // Turn-by-turn means the turns differ. This is the assertion that would
    // have caught the replay cursor never advancing.
    expect(new Set(seen).size).toBe(seen.length);
    // And the scenario actually lands on the root gap, three topics upstream.
    expect(seen.join(' ')).toMatch(/signed-number arithmetic|three topics upstream/i);
  });

  it('reports hasNext correctly and 404s past the end', async () => {
    const scenario = await request(app).get('/api/demo/scenarios/diagnostic-root-gap');
    const last = scenario.body.scenario.totalTurns - 1;

    expect((await request(app).get(`/api/demo/scenarios/diagnostic-root-gap/turns/0`)).body.hasNext).toBe(true);
    expect((await request(app).get(`/api/demo/scenarios/diagnostic-root-gap/turns/${last}`)).body.hasNext).toBe(false);
    expect((await request(app).get(`/api/demo/scenarios/diagnostic-root-gap/turns/${last + 1}`)).status).toBe(404);
  });

  it('rejects a malformed turn index and an unknown scenario', async () => {
    expect((await request(app).get('/api/demo/scenarios/diagnostic-root-gap/turns/-1')).status).toBe(400);
    expect((await request(app).get('/api/demo/scenarios/diagnostic-root-gap/turns/abc')).status).toBe(400);
    expect((await request(app).get('/api/demo/scenarios/no-such-scenario')).status).toBe(404);
  });

  it('never exposes a real family\'s intake session', async () => {
    const { agentSessions } = await import('./db/schema/ai');
    const { newId, nowIso } = await import('../shared/db-values');

    // A live session, with a parent's own words in it.
    await db.insert(agentSessions).values({
      id: newId(),
      type: 'diagnostic_intake',
      goal: 'My son is struggling and I am worried about him',
      transcriptJson: JSON.stringify([{ role: 'parent', text: 'Private family detail.' }]),
      scratchpadJson: JSON.stringify({ demoKey: 'not-a-demo' }),
      status: 'active',
      turnCount: 1,
      isDemoSeed: 0,
      createdAt: nowIso(),
    });

    const res = await request(app).get('/api/demo/scenarios');
    // The repository compares `is_demo_seed` to the literal 1, so there is no
    // filter to relax that would let this through.
    expect(res.body.items).toHaveLength(5);
    expect(JSON.stringify(res.body)).not.toContain('Private family detail');

    expect((await request(app).get('/api/demo/scenarios/not-a-demo')).status).toBe(404);
  });

  it('imports nothing from server/ai on the demonstration path', async () => {
    // The structural half of the guarantee: a flag can be set wrongly, but a
    // module that does not import a provider cannot call one.
    const fs = await import('node:fs');
    for (const file of ['server/routes/demo.ts', 'server/services/demo.ts', 'server/repositories/demo.ts']) {
      const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} imports from server/ai`).not.toMatch(/from\s+['"].*\/ai\//);
    }
  });
});
