/**
 * Demonstration reads — §6.15.
 *
 * One query, deliberately narrow: the seeded agent sessions, and nothing else.
 *
 * `is_demo_seed = 1` is the only rows this module will return. A real family's
 * intake session — a parent describing their child's difficulty in their own
 * words — must never be reachable from an anonymous endpoint, and the cheapest
 * way to guarantee that is for the query that serves that endpoint to be
 * incapable of selecting one.
 */

import { eq } from 'drizzle-orm';

import { agentSessions } from '../db/schema/ai';
import type { Executor } from './_base';

export interface StoredDemoSession {
  id: string;
  type: string;
  goal: string | null;
  transcriptJson: string;
  scratchpadJson: string | null;
  status: string;
  model: string | null;
  promptVersion: string | null;
}

/**
 * Every seeded demonstration session, oldest first.
 *
 * There is no `userId` in the projection and no filter that could be relaxed
 * to include a live session: `is_demo_seed` is compared to the literal 1.
 */
export async function listDemoAgentSessions(db: Executor): Promise<StoredDemoSession[]> {
  return db
    .select({
      id: agentSessions.id,
      type: agentSessions.type,
      goal: agentSessions.goal,
      transcriptJson: agentSessions.transcriptJson,
      scratchpadJson: agentSessions.scratchpadJson,
      status: agentSessions.status,
      model: agentSessions.model,
      promptVersion: agentSessions.promptVersion,
    })
    .from(agentSessions)
    .where(eq(agentSessions.isDemoSeed, 1))
    .orderBy(agentSessions.createdAt, agentSessions.id);
}
