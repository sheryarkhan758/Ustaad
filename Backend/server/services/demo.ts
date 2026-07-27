/**
 * Demonstration scenario assembly — §6.15.
 *
 * Turns a stored `agent_sessions` row into the shape the "See it work" panel
 * renders. Pure functions over rows that have already been fetched: no
 * database, no clock, and — the load-bearing part — **no provider**.
 *
 * This module deliberately imports nothing from `server/ai/`. FR-15.7 requires
 * zero live API calls on the demonstration path, and the way to guarantee that
 * is not a flag but the absence of a dependency: there is no code path from
 * here to a network socket, so no configuration mistake, expired key or
 * exhausted quota can reach it.
 *
 * A malformed stored scenario yields `null` rather than an exception. The panel
 * then shows four scenarios instead of five, which is a bad demonstration; a
 * 500 on the landing page is a broken one.
 */

import { fromDbJson } from '../../shared/db-values';
import type { StoredDemoSession } from '../repositories/demo';

export interface DemoTurn {
  /** Who spoke. `agent` turns are the platform's replies. */
  role: 'parent' | 'tutor' | 'agent';
  text: string;
}

export interface DemoScenarioSummary {
  key: string;
  title: string;
  summary: string;
  /** The FR this scenario exists to demonstrate, e.g. `FR-15.2`. */
  requirement: string;
  type: string;
  totalTurns: number;
  /** Always 0. Stated per scenario so the client can show it (FR-15.7). */
  liveModelCalls: 0;
}

export interface DemoScenario extends DemoScenarioSummary {
  goal: string | null;
  status: string;
  /** Provenance, as §7.3 requires of every AI output row. */
  model: string | null;
  promptVersion: string | null;
  turns: DemoTurn[];
  /**
   * The panel beside the transcript — the deterministic artefact the scenario
   * is really about: a prerequisite chain, a score breakdown, a search
   * predicate. This is where the point of each scenario actually lands.
   */
  exhibit: Record<string, unknown> | null;
}

interface StoredScratchpad {
  demoKey?: string;
  title?: string;
  summary?: string;
  requirement?: string;
  exhibit?: Record<string, unknown> | null;
  /** Present but never read here — replay belongs to the agent, not the panel. */
  replayScript?: string[];
}

const ROLES = new Set(['parent', 'tutor', 'agent']);

function readTurns(transcriptJson: string): DemoTurn[] {
  const raw = fromDbJson<unknown>(transcriptJson, []);
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const candidate = entry as { role?: unknown; text?: unknown };
    if (typeof candidate.role !== 'string' || !ROLES.has(candidate.role)) return [];
    if (typeof candidate.text !== 'string') return [];
    return [{ role: candidate.role as DemoTurn['role'], text: candidate.text }];
  });
}

/**
 * Parse one stored row into a scenario, or `null` if it is not a usable one.
 *
 * A row without a `demoKey` is not addressable and is skipped rather than
 * guessed at — inventing a key from the id would produce a URL that changes
 * every time the seed is re-run.
 */
export function parseStoredScenario(session: StoredDemoSession): DemoScenario | null {
  let scratchpad: StoredScratchpad;
  try {
    scratchpad = fromDbJson<StoredScratchpad>(session.scratchpadJson, {}) ?? {};
  } catch {
    return null;
  }

  const key = scratchpad.demoKey;
  if (!key) return null;

  const turns = readTurns(session.transcriptJson);

  return {
    key,
    title: scratchpad.title ?? session.goal ?? key,
    summary: scratchpad.summary ?? '',
    requirement: scratchpad.requirement ?? '',
    type: session.type,
    totalTurns: turns.length,
    liveModelCalls: 0,
    goal: session.goal,
    status: session.status,
    model: session.model,
    promptVersion: session.promptVersion,
    turns,
    exhibit: scratchpad.exhibit ?? null,
  };
}

export function buildScenarioSummary(session: StoredDemoSession): DemoScenarioSummary | null {
  const scenario = parseStoredScenario(session);
  if (!scenario) return null;
  const { key, title, summary, requirement, type, totalTurns } = scenario;
  return { key, title, summary, requirement, type, totalTurns, liveModelCalls: 0 };
}

/** Every scenario that parsed, in stored order. */
export function buildScenarioList(sessions: StoredDemoSession[]): DemoScenario[] {
  return sessions
    .map(parseStoredScenario)
    .filter((scenario): scenario is DemoScenario => scenario !== null);
}

export function findScenarioByKey(
  sessions: StoredDemoSession[],
  key: string,
): DemoScenario | null {
  return buildScenarioList(sessions).find((scenario) => scenario.key === key) ?? null;
}
