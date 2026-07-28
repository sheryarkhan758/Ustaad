/**
 * The audit log writer — NFR-19, SEC-13, FR-14.4.
 *
 * **`admin_actions` is append-only.**  This module is the only permitted writer,
 * and it exposes exactly one operation: append.  There is no update function
 * here, no delete function, and none may be added — not for corrections, not
 * for cleanup, not for a test helper.  A mistaken entry is corrected by
 * appending a corrective entry that references it.
 *
 * That constraint is the whole reason the verification chain of custody in §6.6
 * means anything.  "Verified by this administrator, at this time, against these
 * artefacts" is a claim about the past; if the row can be rewritten, it is a
 * claim about the present instead, and worth nothing.
 *
 * Reads are deliberately narrow and are for administrators only.
 */

import { and, desc, eq } from 'drizzle-orm';

import { fromDbJson, fromDbTimestamp, newId, nowIso, toDbJson } from '../../shared/db-values';
import { adminActions } from '../db/schema/admin';
import type { Executor } from '../repositories/_base';

type AnyDb = Pick<Executor, 'select' | 'insert'>;

/** An audit entry as the rest of the application sees it. */
export interface AuditEntry {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

function toDomain(row: typeof adminActions.$inferSelect): AuditEntry {
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    detail: fromDbJson<Record<string, unknown>>(row.detailJson),
    createdAt: fromDbTimestamp(row.createdAt),
  };
}

/**
 * Keys that must never appear in `detailJson`.
 *
 * The audit log is the one table guaranteed never to be deleted from, so a
 * secret written here is written permanently.  CLAUDE.md §2.2 forbids logging a
 * CNIC, a password, a token or a full address; this makes that mechanical for
 * the one sink where a mistake is irreversible.
 */
const FORBIDDEN_DETAIL_KEYS = [
  'cnic',
  'cnic_number',
  'cnicNumber',
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'accessToken',
  'jwt',
  'address',
  'addressEncrypted',
  'address_encrypted',
  'fullAddress',
] as const;

export class AuditDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditDetailError';
  }
}

function assertDetailIsSafe(detail: Record<string, unknown> | undefined, path = 'detailJson'): void {
  if (!detail) return;
  for (const [key, value] of Object.entries(detail)) {
    if ((FORBIDDEN_DETAIL_KEYS as readonly string[]).includes(key)) {
      throw new AuditDetailError(
        `"${path}.${key}" may not be written to the audit log. The log is append-only ` +
          'and never deleted, so a CNIC, password, token or full address written here is ' +
          'permanent (CLAUDE.md §2.2, SEC-8). Record an identifier instead.',
      );
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertDetailIsSafe(value as Record<string, unknown>, `${path}.${key}`);
    }
  }
}

export interface AppendAdminActionInput {
  adminUserId: string;
  /** Dotted verb, e.g. `tutor.identity_approved`, `payment_dispute.resolved`. */
  action: string;
  targetType: string;
  targetId: string;
  /** Structured context. Which artefacts were checked, the written reason, etc. */
  detailJson?: Record<string, unknown>;
}

/**
 * Append one entry.  The only write operation against `admin_actions`.
 *
 * Call this from every administrator decision that affects a person:
 * verification approval and rejection (FR-6.6, FR-6.7), appeal override
 * (SEC-18), dispute resolution (FR-31.7), flag resolution (FR-14.2), feedback
 * triage (FR-32.7), taxonomy edits (FR-14.5).
 */
export async function appendAdminAction(
  db: AnyDb,
  input: AppendAdminActionInput,
): Promise<AuditEntry> {
  assertDetailIsSafe(input.detailJson);

  // Id generated here, then read back by that id — no RETURNING assumption
  // (PORTABILITY rule 4).
  const id = newId();
  await db.insert(adminActions).values({
    id,
    adminUserId: input.adminUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detailJson: toDbJson(input.detailJson),
    createdAt: nowIso(),
  });

  const rows = await db.select().from(adminActions).where(eq(adminActions.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`audit entry "${id}" vanished immediately after insert`);
  return toDomain(row);
}

/**
 * The chain of custody for one target, oldest first — what §6.9's public
 * verification record is built from.
 */
export async function readAuditTrailFor(
  db: AnyDb,
  targetType: string,
  targetId: string,
): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(adminActions)
    .where(and(eq(adminActions.targetType, targetType), eq(adminActions.targetId, targetId)))
    .orderBy(adminActions.createdAt);
  return rows.map(toDomain);
}

/** Recent actions by one administrator.  Administrator-facing only. */
export async function readRecentActionsBy(
  db: AnyDb,
  adminUserId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(adminActions)
    .where(eq(adminActions.adminUserId, adminUserId))
    .orderBy(desc(adminActions.createdAt))
    .limit(limit);
  return rows.map(toDomain);
}

/**
 * The whole log, newest first, narrowed — FR-14.2's viewer.
 *
 * ── Read-only, and structurally so ─────────────────────────────────────────
 * This file exports `appendAdminAction` and three readers. There is no update
 * and no delete anywhere in it, and §2.7 says a mistake is corrected by
 * appending a corrective entry rather than by editing the record of the
 * original one. A viewer that offered an edit control would be offering an
 * operation the service cannot perform.
 *
 * ── Why the filters are these three ────────────────────────────────────────
 * Actor, action and target type are the three questions somebody actually
 * arrives with: what did this administrator do, who did this thing, and what
 * happened to verifications this week. They narrow rows; none of them can
 * reveal a row the caller could not already read, because the whole table is
 * administrator-only.
 *
 * `detailJson` is returned as stored. `appendAdminAction` already refuses to
 * write a forbidden key into it, so the redaction happened on the way in — the
 * viewer does not need a second, weaker copy of that rule.
 */
export interface AuditQuery {
  adminUserId?: string;
  action?: string;
  targetType?: string;
  limit?: number;
}

export async function readAuditLog(db: AnyDb, query: AuditQuery = {}): Promise<AuditEntry[]> {
  const conditions = [
    query.adminUserId ? eq(adminActions.adminUserId, query.adminUserId) : undefined,
    query.action ? eq(adminActions.action, query.action) : undefined,
    query.targetType ? eq(adminActions.targetType, query.targetType) : undefined,
  ].filter((condition) => condition !== undefined);

  const rows = await db
    .select()
    .from(adminActions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // Newest first: an operations tool is read from the top.
    .orderBy(desc(adminActions.createdAt))
    .limit(Math.min(query.limit ?? 100, 500));

  return rows.map(toDomain);
}
