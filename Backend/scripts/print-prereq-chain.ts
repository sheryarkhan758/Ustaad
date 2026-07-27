/**
 * Walks the topic prerequisite graph and prints what a student must already be
 * able to do before a given topic is teachable.
 *
 * This is the specification's §2.4 argument made executable: a student failing
 * quadratic equations usually has an unrepaired weakness two chapters upstream,
 * and subject-level search cannot express that.  The AI diagnostic agent
 * (§6.10) walks this same graph to build its gap map — it does not invent the
 * chain, it reads it (CLAUDE.md §2.9).
 *
 *   npx tsx scripts/print-prereq-chain.ts
 *   npx tsx scripts/print-prereq-chain.ts math-matric-punjab-quadratic-equations
 *   npx tsx scripts/print-prereq-chain.ts --list quadratic
 */

import 'dotenv/config';
import { db } from '../server/db/index';
import { boards, levels, subjects, topicPrerequisites, topics } from '../server/db/schema/reference';

const DEFAULT_TOPIC = 'math-matric-sindh-quadratic-equations';

interface TopicRow {
  id: string;
  name: string;
  nameUr: string;
  chapterRef: string | null;
  subjectId: string;
  levelId: string;
  boardId: string;
}

async function loadGraph() {
  const topicRows = await db
    .select({
      id: topics.id,
      name: topics.name,
      nameUr: topics.nameUr,
      chapterRef: topics.chapterRef,
      subjectId: topics.subjectId,
      levelId: topics.levelId,
      boardId: topics.boardId,
    })
    .from(topics)
    ;

  const edges = await db
    .select({
      topicId: topicPrerequisites.topicId,
      prerequisiteTopicId: topicPrerequisites.prerequisiteTopicId,
    })
    .from(topicPrerequisites)
    ;

  const byId = new Map<string, TopicRow>(topicRows.map((t) => [t.id, t]));
  const prereqsOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = prereqsOf.get(edge.topicId);
    if (list) list.push(edge.prerequisiteTopicId);
    else prereqsOf.set(edge.topicId, [edge.prerequisiteTopicId]);
  }

  const subjectRows = await db.select().from(subjects);
  const levelRows = await db.select().from(levels);
  const boardRows = await db.select().from(boards);

  const names = {
    subject: new Map(subjectRows.map((r) => [r.id, r.name])),
    level: new Map(levelRows.map((r) => [r.id, r.name])),
    board: new Map(boardRows.map((r) => [r.id, r.name])),
  };

  return { byId, prereqsOf, names };
}

type Names = Awaited<ReturnType<typeof loadGraph>>['names'];

function labelFor(topic: TopicRow, names: Names): string {
  const subject = names.subject.get(topic.subjectId) ?? topic.subjectId;
  const level = names.level.get(topic.levelId) ?? topic.levelId;
  const board = names.board.get(topic.boardId) ?? topic.boardId;
  return `${subject} · ${level} · ${board}`;
}

/**
 * Depth-first walk upstream, printing an indented tree.  `seen` prevents a
 * shared prerequisite being expanded twice; the graph is a DAG, not a tree, so
 * `algebraic-expressions` legitimately appears under more than one parent.
 */
function printUpstream(
  id: string,
  byId: Map<string, TopicRow>,
  prereqsOf: Map<string, string[]>,
  depth: number,
  seen: Set<string>,
  isLast: boolean,
  prefix: string,
): void {
  const topic = byId.get(id);
  if (!topic) {
    console.log(`${prefix}${isLast ? '└─ ' : '├─ '}⚠ unknown topic "${id}"`);
    return;
  }

  const connector = depth === 0 ? '' : isLast ? '└─ ' : '├─ ';
  const chapter = topic.chapterRef ? `  [${topic.chapterRef}]` : '';
  const repeated = seen.has(id) ? '  (already shown above)' : '';
  console.log(`${prefix}${connector}${topic.name}${chapter}${repeated}`);
  console.log(`${prefix}${depth === 0 ? '' : isLast ? '   ' : '│  '}   ${topic.nameUr}`);

  if (seen.has(id)) return;
  seen.add(id);

  const prereqs = prereqsOf.get(id) ?? [];
  const childPrefix = depth === 0 ? '' : prefix + (isLast ? '   ' : '│  ');
  prereqs.forEach((prereqId, index) => {
    printUpstream(
      prereqId,
      byId,
      prereqsOf,
      depth + 1,
      seen,
      index === prereqs.length - 1,
      childPrefix,
    );
  });
}

/** Longest path upstream — the full remediation sequence, deepest first. */
function teachingOrder(
  id: string,
  prereqsOf: Map<string, string[]>,
  byId: Map<string, TopicRow>,
): TopicRow[] {
  const order: TopicRow[] = [];
  const visited = new Set<string>();

  const visit = (node: string): void => {
    if (visited.has(node)) return;
    visited.add(node);
    for (const prereq of prereqsOf.get(node) ?? []) visit(prereq);
    const topic = byId.get(node);
    if (topic) order.push(topic);
  };

  visit(id);
  return order;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { byId, prereqsOf, names } = await loadGraph();

  if (args[0] === '--list') {
    const needle = (args[1] ?? '').toLowerCase();
    const matches = [...byId.values()].filter(
      (t) => t.id.includes(needle) || t.name.toLowerCase().includes(needle),
    );
    for (const topic of matches) console.log(`${topic.id}\n    ${topic.name} — ${labelFor(topic, names)}`);
    console.log(`\n${matches.length} topic(s) matched.`);
    return;
  }

  const targetId = args[0] ?? DEFAULT_TOPIC;
  const target = byId.get(targetId);

  if (!target) {
    console.error(`Unknown topic "${targetId}".`);
    console.error('Try:  npx tsx scripts/print-prereq-chain.ts --list quadratic');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('═'.repeat(72));
  console.log(`  Prerequisite chain for: ${target.name}`);
  console.log(`  ${labelFor(target, names)}`);
  console.log('═'.repeat(72));
  console.log('');
  console.log('Upstream dependencies (what must already be secure):');
  console.log('');
  printUpstream(targetId, byId, prereqsOf, 0, new Set(), true, '');

  const order = teachingOrder(targetId, prereqsOf, byId);
  console.log('');
  console.log('Teaching order (repair from the top down):');
  console.log('');
  order.forEach((topic, index) => {
    const marker = topic.id === targetId ? '←  the presenting symptom' : '';
    console.log(`  ${String(index + 1).padStart(2)}. ${topic.name}  ${marker}`);
  });

  console.log('');
  console.log(
    `${order.length} topic(s) in the chain. This walk is deterministic: it reads\n` +
      'topic_prerequisites and nothing else. No model is involved (CLAUDE.md §2.9).',
  );
  console.log('');
}

await main();
