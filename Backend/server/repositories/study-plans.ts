/**
 * Stored study plans — §6.25, §6.26.
 *
 * A read-only view of what `server/ai/study-plan.ts` already generated. This
 * module never calls a provider: the countdown view and the timeline both
 * display a plan that exists, and regenerating one in order to show it would
 * spend a model call on a page load (§7.4).
 *
 * `prereqValidated` is carried through to the client deliberately. FR-26.2
 * validates the ordering against the prerequisite graph **in code after
 * generation** and regenerates on violation; a plan that merely looks ordered
 * and a plan that was checked are different things, and the interface says
 * which one it is showing.
 */

import { desc, eq } from 'drizzle-orm';

import { fromDbBool, fromDbJson } from '../../shared/db-values';
import type { StudyPlanStep } from '../../shared/ai-contract';
import { studyPlans } from '../db/schema/ai';
import type { Executor } from './_base';

/** A step with the real dates application code computed for it (FR-26.4). */
export interface StoredPlanStep extends StudyPlanStep {
  startDate?: string;
  endDate?: string;
}

export interface StoredStudyPlan {
  id: string;
  diagnosticId: string;
  studentProfileId: string | null;
  levelId: string | null;
  targetDate: string | null;
  steps: StoredPlanStep[];
  summary: string;
  /** Whether the ordering was checked against the prerequisite graph. */
  prereqValidated: boolean;
  createdAt: string;
}

interface StoredPlanJson {
  steps?: StoredPlanStep[];
  summary?: string;
}

/** Newest first — a family with two plans wants the current one. */
export async function listStudyPlansForStudent(
  db: Executor,
  studentProfileId: string,
): Promise<StoredStudyPlan[]> {
  const rows = await db
    .select()
    .from(studyPlans)
    .where(eq(studyPlans.studentProfileId, studentProfileId))
    .orderBy(desc(studyPlans.createdAt));

  return rows.map((row) => {
    const plan = fromDbJson<StoredPlanJson>(row.planJson, {});
    return {
      id: row.id,
      diagnosticId: row.diagnosticId,
      studentProfileId: row.studentProfileId,
      levelId: row.levelId,
      targetDate: row.targetDate,
      steps: plan.steps ?? [],
      summary: plan.summary ?? '',
      prereqValidated: fromDbBool(row.prereqValidated),
      createdAt: row.createdAt,
    };
  });
}
