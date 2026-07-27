/**
 * Seed-time integrity checks.
 *
 * Every check here runs **before a single row is written**.  Reference data is
 * committed to the repository and is depended on by the diagnostic agent, by
 * search, and by group matching; a malformed graph or a one-way adjacency would
 * surface much later as a wrong answer rather than as an error.  So these fail
 * loudly, with the offending rows named, and the seed aborts.
 */

/** Thrown when seed data is structurally invalid.  Never caught by the seeder. */
export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedValidationError';
  }
}

function fail(title: string, details: string[]): never {
  const body = details.map((d) => `  · ${d}`).join('\n');
  throw new SeedValidationError(`${title}\n${body}`);
}

/** Every id in a reference table must be unique. */
export function assertUniqueIds(label: string, rows: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) duplicates.push(row.id);
    seen.add(row.id);
  }
  if (duplicates.length > 0) {
    fail(`Duplicate ${label} ids in seed data:`, [...new Set(duplicates)]);
  }
}

/** Every foreign key in `rows` must point at an id that exists in `parentIds`. */
export function assertReferencesExist(
  label: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  field: string,
  parentLabel: string,
  parentIds: ReadonlySet<string>,
): void {
  const dangling: string[] = [];
  for (const row of rows) {
    const value = row[field];
    if (typeof value !== 'string') continue;
    if (!parentIds.has(value)) {
      dangling.push(`${label} "${String(row.id ?? '?')}" → unknown ${parentLabel} "${value}"`);
    }
  }
  if (dangling.length > 0) {
    fail(`Dangling ${field} reference(s) in ${label} seed data:`, dangling);
  }
}

/* -------------------------------------------------------------------------
 * Area adjacency
 * ---------------------------------------------------------------------- */

export interface AdjacencyRow {
  areaId: string;
  adjacentAreaId: string;
  travelMinutes: number;
}

/**
 * Adjacency must be:
 *   1. free of self-loops — an area is not adjacent to itself;
 *   2. symmetric, with matching `travelMinutes` in both directions;
 *   3. confined to a single city (FR-2.9 defines adjacency within a city);
 *   4. positive in travel time.
 *
 * (2) matters because search expands from a chosen area outwards.  A one-way
 * edge would make "areas near Clifton" and "areas near DHA" disagree, and the
 * disagreement would be invisible until a family wondered why a tutor appeared
 * in one search and not the reverse.
 */
export function assertAdjacencyWellFormed(
  rows: ReadonlyArray<AdjacencyRow>,
  areaCityById: ReadonlyMap<string, string>,
): void {
  const problems: string[] = [];
  const byPair = new Map<string, AdjacencyRow>();

  for (const row of rows) {
    const key = `${row.areaId}→${row.adjacentAreaId}`;

    if (row.areaId === row.adjacentAreaId) {
      problems.push(`self-loop on "${row.areaId}"`);
      continue;
    }
    if (byPair.has(key)) {
      problems.push(`duplicate edge ${key}`);
      continue;
    }
    if (!Number.isInteger(row.travelMinutes) || row.travelMinutes <= 0) {
      problems.push(`${key} has non-positive travel_minutes (${row.travelMinutes})`);
    }

    const cityA = areaCityById.get(row.areaId);
    const cityB = areaCityById.get(row.adjacentAreaId);
    if (cityA === undefined) problems.push(`${key} references unknown area "${row.areaId}"`);
    if (cityB === undefined) problems.push(`${key} references unknown area "${row.adjacentAreaId}"`);
    if (cityA !== undefined && cityB !== undefined && cityA !== cityB) {
      problems.push(`${key} crosses cities (${cityA} → ${cityB}); adjacency is within-city only`);
    }

    byPair.set(key, row);
  }

  for (const row of byPair.values()) {
    const reverse = byPair.get(`${row.adjacentAreaId}→${row.areaId}`);
    if (!reverse) {
      problems.push(
        `asymmetric edge: ${row.areaId}→${row.adjacentAreaId} exists but the reverse does not`,
      );
    } else if (reverse.travelMinutes !== row.travelMinutes) {
      problems.push(
        `asymmetric travel_minutes between ${row.areaId} and ${row.adjacentAreaId}: ` +
          `${row.travelMinutes} vs ${reverse.travelMinutes}`,
      );
    }
  }

  if (problems.length > 0) {
    fail('area_adjacency seed data is not well formed:', problems);
  }
}

/* -------------------------------------------------------------------------
 * Topic prerequisite graph
 * ---------------------------------------------------------------------- */

export interface PrerequisiteEdge {
  topicId: string;
  prerequisiteTopicId: string;
}

/**
 * The prerequisite graph must be a DAG (FR-3.4).
 *
 * A cycle would make the diagnostic agent's upstream walk non-terminating and
 * the resulting gap map incoherent — "to learn A you must first learn B, and to
 * learn B you must first learn A" is not a study plan.  Depth-first search with
 * an explicit path stack so the error names the exact cycle rather than merely
 * reporting that one exists.
 */
export function assertPrerequisiteGraphIsAcyclic(edges: ReadonlyArray<PrerequisiteEdge>): void {
  const problems: string[] = [];

  // topic → its prerequisites
  const prereqsOf = new Map<string, string[]>();
  const seenEdges = new Set<string>();

  for (const edge of edges) {
    if (edge.topicId === edge.prerequisiteTopicId) {
      problems.push(`topic "${edge.topicId}" is listed as its own prerequisite`);
      continue;
    }
    const key = `${edge.topicId}→${edge.prerequisiteTopicId}`;
    if (seenEdges.has(key)) {
      problems.push(`duplicate prerequisite edge ${key}`);
      continue;
    }
    seenEdges.add(key);
    const list = prereqsOf.get(edge.topicId);
    if (list) list.push(edge.prerequisiteTopicId);
    else prereqsOf.set(edge.topicId, [edge.prerequisiteTopicId]);
  }

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const path: string[] = [];

  const visit = (node: string): void => {
    const current = state.get(node) ?? UNVISITED;
    if (current === DONE) return;
    if (current === IN_PROGRESS) {
      const start = path.indexOf(node);
      const cycle = [...path.slice(start), node].join(' → ');
      problems.push(`cycle: ${cycle}`);
      return;
    }

    state.set(node, IN_PROGRESS);
    path.push(node);
    for (const prereq of prereqsOf.get(node) ?? []) visit(prereq);
    path.pop();
    state.set(node, DONE);
  };

  for (const node of prereqsOf.keys()) visit(node);

  if (problems.length > 0) {
    fail('topic_prerequisites is not a directed acyclic graph:', problems);
  }
}

/**
 * A prerequisite edge that crosses boards is almost always an authoring
 * mistake: Cambridge O Level "Quadratic Equations" is a different unit of work
 * from the Sindh Board chapter of the same name, so requiring one for the other
 * would be wrong (decision 5).  Cross-*level* and cross-*subject* edges are
 * legitimate — Intermediate builds on Matric, and Physics kinematics genuinely
 * requires algebraic manipulation — so only the board is checked.
 */
export function assertPrerequisitesShareBoard(
  edges: ReadonlyArray<PrerequisiteEdge>,
  topicBoardById: ReadonlyMap<string, string>,
): void {
  const problems: string[] = [];
  for (const edge of edges) {
    const a = topicBoardById.get(edge.topicId);
    const b = topicBoardById.get(edge.prerequisiteTopicId);
    if (a === undefined) problems.push(`unknown topic "${edge.topicId}"`);
    if (b === undefined) problems.push(`unknown topic "${edge.prerequisiteTopicId}"`);
    if (a !== undefined && b !== undefined && a !== b) {
      problems.push(
        `${edge.topicId} (${a}) requires ${edge.prerequisiteTopicId} (${b}) — boards differ`,
      );
    }
  }
  if (problems.length > 0) {
    fail('topic_prerequisites crosses examination boards:', problems);
  }
}

/* -------------------------------------------------------------------------
 * Interface strings
 * ---------------------------------------------------------------------- */

/**
 * Every interface key must exist in both English and Urdu.  A missing Urdu
 * string is not a cosmetic gap: §6.27 and NFR-17 require the Urdu view to be
 * verified before submission, and a key that silently falls back to English
 * makes that check unreliable.
 */
export function assertI18nComplete(
  rows: ReadonlyArray<{ key: string; lang: string; value: string }>,
  langs: ReadonlyArray<string>,
): void {
  const byKey = new Map<string, Set<string>>();
  const problems: string[] = [];

  for (const row of rows) {
    if (row.value.trim() === '') problems.push(`empty value for "${row.key}" (${row.lang})`);
    const set = byKey.get(row.key);
    if (set) {
      if (set.has(row.lang)) problems.push(`duplicate "${row.key}" for lang "${row.lang}"`);
      set.add(row.lang);
    } else {
      byKey.set(row.key, new Set([row.lang]));
    }
  }

  for (const [key, present] of byKey) {
    for (const lang of langs) {
      if (!present.has(lang)) problems.push(`"${key}" is missing the "${lang}" translation`);
    }
  }

  if (problems.length > 0) {
    fail('i18n_strings seed data is incomplete:', problems);
  }
}
