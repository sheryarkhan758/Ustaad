/**
 * The progress ledger's arithmetic — FR-12.2, FR-12.3, FR-12.4.
 *
 * Pure functions, so these are unit tests with no database and no clock.
 */

import { describe, expect, it } from 'vitest';

import {
  GAP_ADDRESSED_RATING,
  STAGNATION_SESSIONS,
  buildMasterySeries,
  compareGapMapToCoverage,
  readGapsFromGapMap,
  sessionsSinceLastIncrease,
  type MasteryObservation,
} from './progress';

const at = (n: number): string => `2026-07-${String(n).padStart(2, '0')}T10:00:00.000Z`;

function observe(topicId: string, ratings: number[]): MasteryObservation[] {
  return ratings.map((rating, i) => ({
    topicId,
    rating,
    at: at(i + 1),
    bookingId: `booking-${i + 1}`,
  }));
}

describe('sessionsSinceLastIncrease — the FR-12.4 rule', () => {
  it('counts every session when mastery never rose', () => {
    expect(sessionsSinceLastIncrease([3, 3, 3])).toBe(3);
  });

  it('counts only the sessions after the last genuine increase', () => {
    expect(sessionsSinceLastIncrease([2, 3, 3, 3])).toBe(3);
    expect(sessionsSinceLastIncrease([3, 3, 4])).toBe(1);
  });

  it('treats a fall as no improvement, not as a reset', () => {
    // 4 → 3 → 3 is three sessions without progress, and it is the case a parent
    // most needs to see. A rule that only looked for identical values would
    // report two.
    expect(sessionsSinceLastIncrease([4, 3, 3])).toBe(3);
  });

  it('is zero for no data', () => {
    expect(sessionsSinceLastIncrease([])).toBe(0);
  });
});

describe('buildMasterySeries — FR-12.2', () => {
  it('charts a topic over time and reports the change', () => {
    const [series] = buildMasterySeries(observe('algebra', [2, 3, 4]));
    expect(series!.sessions).toBe(3);
    expect(series!.firstRating).toBe(2);
    expect(series!.latestRating).toBe(4);
    expect(series!.change).toBe(2);
    expect(series!.stagnant).toBe(false);
  });

  it('flags stagnation at three sessions without an increase', () => {
    const [series] = buildMasterySeries(observe('fractions', [3, 3, 3]));
    expect(series!.sessionsSinceImprovement).toBe(STAGNATION_SESSIONS);
    expect(series!.stagnant).toBe(true);
  });

  it('does not flag two flat sessions', () => {
    expect(buildMasterySeries(observe('fractions', [3, 3]))[0]!.stagnant).toBe(false);
  });

  it('reports the best rating separately from the latest', () => {
    // A student who reached 5 and slipped to 3 has not lost the 5; the ledger
    // should not imply they never got there.
    const [series] = buildMasterySeries(observe('geometry', [3, 5, 3]));
    expect(series!.best).toBe(5);
    expect(series!.latestRating).toBe(3);
  });

  it('orders by timestamp regardless of the order rows arrive in', () => {
    const shuffled = [...observe('algebra', [2, 3, 4])].reverse();
    const [series] = buildMasterySeries(shuffled);
    expect(series!.points.map((p) => p.rating)).toEqual([2, 3, 4]);
  });
});

describe('compareGapMapToCoverage — FR-12.3', () => {
  const gaps = [
    { topicId: 'integers', isRootGap: true, confidence: 0.9, rationale: 'Root gap.' },
    { topicId: 'quadratics', isRootGap: false, confidence: 0.8, rationale: 'Symptom.' },
    { topicId: 'never-taught', isRootGap: false, confidence: 0.7, rationale: 'Also weak.' },
  ];

  it('marks a gap addressed only once mastery reaches the bar', () => {
    const series = buildMasterySeries([
      ...observe('integers', [2, 3, GAP_ADDRESSED_RATING]),
      ...observe('quadratics', [2, 3]),
    ]);
    const coverage = compareGapMapToCoverage(gaps, series);

    expect(coverage.find((c) => c.topicId === 'integers')!.state).toBe('addressed');
    // Three of five is being worked on, not closed.
    expect(coverage.find((c) => c.topicId === 'quadratics')!.state).toBe('in_progress');
  });

  it('shows a diagnosed gap that was never taught, with zero sessions', () => {
    const coverage = compareGapMapToCoverage(gaps, buildMasterySeries(observe('integers', [4])));
    const untouched = coverage.find((c) => c.topicId === 'never-taught')!;
    // The row that says the plan and the teaching have come apart.
    expect(untouched.state).toBe('not_addressed');
    expect(untouched.sessions).toBe(0);
    expect(untouched.latestRating).toBeNull();
  });

  it('lists root gaps first', () => {
    expect(compareGapMapToCoverage(gaps, [])[0]!.isRootGap).toBe(true);
  });

  it('invents no gaps from topics that were taught but never diagnosed', () => {
    const series = buildMasterySeries(observe('trigonometry', [4]));
    const coverage = compareGapMapToCoverage(gaps, series);
    expect(coverage.map((c) => c.topicId)).not.toContain('trigonometry');
    expect(coverage).toHaveLength(gaps.length);
  });
});

describe('readGapsFromGapMap', () => {
  it('reads the shape the intake agent writes', () => {
    const gaps = readGapsFromGapMap({
      gaps: [{ topicId: 'integers', confidence: 0.9, rationale: 'Root gap.', isRootGap: true }],
      confidence: 0.9,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.isRootGap).toBe(true);
  });

  it('returns nothing rather than throwing on a malformed column', () => {
    // The mastery half of the ledger is still true and still worth showing.
    expect(readGapsFromGapMap({ nonsense: true })).toEqual([]);
    expect(readGapsFromGapMap(null)).toEqual([]);
  });
});
