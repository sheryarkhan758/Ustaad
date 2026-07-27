/**
 * `admin_actions` is append-only — NFR-19, SEC-13, FR-14.4.
 *
 * The claim CLAUDE.md §2.7 makes is absolute: *"No application path issues an
 * `UPDATE` or a `DELETE` against it — not for corrections, not for cleanup, not
 * in a migration, not in a test helper, not in an admin tool."*
 *
 * That claim is defended twice, and this file exercises both defences:
 *
 *  1. **At runtime**, by `server/db/runtime-guards.ts`, which wraps the Drizzle
 *     handle so `db.update(adminActions)` and `db.delete(adminActions)` throw
 *     before a statement is built. Every handle in the process is wrapped —
 *     `server/db/index.ts` for production, `server/db/test-db.ts` for the suite
 *     — so there is no unguarded handle a caller could reach for.
 *  2. **Structurally**, by a sweep over the source, because a guard that only
 *     fires at runtime is a guard nobody meets until the wrong moment.
 *
 * Why this matters more than it looks: the verification chain of custody in §6.6
 * is the platform's substantive answer to fraud. "Verified by this
 * administrator, at this time, against these artefacts" is a claim about the
 * past. If the row can be rewritten it becomes a claim about the present, and
 * the whole of §2.5 is decoration.
 */

import fs from 'node:fs';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { newId, nowIso } from '../../shared/db-values';
import { adminActions } from '../db/schema/admin';
import { flags } from '../db/schema/admin';
import { users } from '../db/schema/identity';
import { createSeededTestDb, type TestDb } from '../db/test-db';
import { appendAdminAction, readAuditTrailFor } from './audit';

let db: TestDb;
let adminUserId: string;

beforeEach(async () => {
  db = await createSeededTestDb();

  adminUserId = newId();
  await db.insert(users).values({
    id: adminUserId,
    email: `audit-admin-${adminUserId}@example.test`,
    passwordHash: 'not-a-real-hash',
    role: 'admin',
    displayName: 'Audit Administrator',
    status: 'active',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
});

/* =========================================================================
 * The runtime guard — the test the task asks for: try, and fail
 * ====================================================================== */

describe('admin_actions rejects every mutation at the repository boundary', () => {
  it('refuses an UPDATE', async () => {
    const entry = await appendAdminAction(db, {
      adminUserId,
      action: 'tutor.identity_approved',
      targetType: 'tutor_profile',
      targetId: 'tutor-1',
      detailJson: { artefactsChecked: ['cnic'], reason: 'CNIC checked against the submitted image.' },
    });

    expect(() =>
      db.update(adminActions).set({ action: 'tutor.identity_rejected' }).where(eq(adminActions.id, entry.id)),
    ).toThrow(/append-only/i);

    // And the row is exactly as written.
    const after = await db.select().from(adminActions).where(eq(adminActions.id, entry.id));
    expect(after).toHaveLength(1);
    expect(after[0]!.action).toBe('tutor.identity_approved');
  });

  it('refuses a DELETE', async () => {
    const entry = await appendAdminAction(db, {
      adminUserId,
      action: 'flag.resolved',
      targetType: 'review',
      targetId: 'review-1',
      detailJson: { reason: 'The report was confirmed and the content removed.' },
    });

    expect(() => db.delete(adminActions).where(eq(adminActions.id, entry.id))).toThrow(
      /append-only/i,
    );

    expect(await db.select().from(adminActions).where(eq(adminActions.id, entry.id))).toHaveLength(1);
  });

  it('refuses an unfiltered DELETE — the "clean up the test data" case', async () => {
    await appendAdminAction(db, {
      adminUserId,
      action: 'payment_dispute.resolved',
      targetType: 'payment_dispute',
      targetId: 'dispute-1',
      detailJson: { reason: 'Both parties confirmed the session took place.' },
    });

    // No `.where()`. This is the shape a cleanup helper takes, and it is the one
    // that would empty the log rather than corrupt one row of it.
    expect(() => db.delete(adminActions)).toThrow(/append-only/i);
    expect(await db.select().from(adminActions)).toHaveLength(1);
  });

  it('still allows UPDATE and DELETE against every other table', async () => {
    // The guard has to be narrow. A proxy that broke ordinary writes would be
    // removed within a week, and then nothing would protect the log.
    const flagId = newId();
    await db.insert(flags).values({
      id: flagId,
      targetType: 'tutor_profile',
      targetId: 'tutor-1',
      reporterUserId: null,
      reason: 'inaccurate_profile',
      detail: null,
      status: 'open',
      createdAt: nowIso(),
    });

    await db.update(flags).set({ status: 'dismissed' }).where(eq(flags.id, flagId));
    expect((await db.select().from(flags).where(eq(flags.id, flagId)))[0]!.status).toBe('dismissed');

    await db.delete(flags).where(eq(flags.id, flagId));
    expect(await db.select().from(flags).where(eq(flags.id, flagId))).toHaveLength(0);
  });

  it('corrects a mistake by appending, which is the only route available', async () => {
    const wrong = await appendAdminAction(db, {
      adminUserId,
      action: 'tutor.identity_approved',
      targetType: 'tutor_profile',
      targetId: 'tutor-2',
      detailJson: { artefactsChecked: ['cnic', 'degree'], reason: 'Both artefacts checked.' },
    });

    await appendAdminAction(db, {
      adminUserId,
      action: 'tutor.identity_approval_corrected',
      targetType: 'tutor_profile',
      targetId: 'tutor-2',
      detailJson: {
        corrects: wrong.id,
        artefactsChecked: ['cnic'],
        reason: 'The degree certificate was not in fact reviewed. Correcting the record.',
      },
    });

    const trail = await readAuditTrailFor(db, 'tutor_profile', 'tutor-2');
    // Both entries survive. The trail says what was claimed and what was
    // corrected — which is more information than an edit would have left.
    expect(trail).toHaveLength(2);
    expect(trail[0]!.action).toBe('tutor.identity_approved');
    expect(trail[1]!.detail).toMatchObject({ corrects: wrong.id });
  });
});

/* =========================================================================
 * The append writer refuses to write a secret it can never take back
 * ====================================================================== */

describe('appendAdminAction refuses forbidden detail', () => {
  const forbidden: [string, Record<string, unknown>][] = [
    ['a CNIC number', { cnic: '42101-1234567-1' }],
    ['a password', { password: 'hunter2' }],
    ['a session token', { token: 'eyJhbGciOi' }],
    ['a residential address', { address: '12 Example Street, Clifton' }],
    ['a nested address', { booking: { fullAddress: '12 Example Street' } }],
  ];

  for (const [what, detail] of forbidden) {
    it(`refuses ${what}`, async () => {
      // The log is the one table guaranteed never to be deleted from, so a
      // secret written here is written permanently (§2.2, SEC-8).
      await expect(
        appendAdminAction(db, {
          adminUserId,
          action: 'tutor.identity_approved',
          targetType: 'tutor_profile',
          targetId: 'tutor-3',
          detailJson: detail,
        }),
      ).rejects.toThrow(/may not be written to the audit log/i);

      expect(await db.select().from(adminActions)).toHaveLength(0);
    });
  }
});

/* =========================================================================
 * Structural — no source file anywhere issues either statement
 * ====================================================================== */

describe('no application path can issue an UPDATE or DELETE against admin_actions', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const sources = (): string[] =>
    [...walk('server'), ...walk('shared'), ...walk('scripts')].filter(
      (file) => !file.endsWith('.test.ts'),
    );

  it('has no .update(adminActions) or .delete(adminActions) in any source file', () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const code = strip(fs.readFileSync(file, 'utf8'));
      if (/\.(update|delete)\(\s*adminActions\s*\)/.test(code)) offenders.push(file);
    }
    expect(offenders, `these files mutate the audit log: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no raw SQL naming admin_actions in an UPDATE or DELETE', () => {
    // Belt and braces: the runtime guard matches on the Drizzle table object, so
    // a raw fragment would slip past it. §2.1 forbids raw SQL outside
    // `server/db/queries/`, and this makes the audit-log case specific.
    const offenders: string[] = [];
    for (const file of sources()) {
      const code = strip(fs.readFileSync(file, 'utf8'));
      if (/(update|delete\s+from)\s+[`"']?admin_actions/i.test(code)) offenders.push(file);
    }
    expect(offenders, `these files hand-write a mutation of the log: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  const migrationFiles = (): { name: string; sql: string }[] =>
    ['server/db/migrations', 'server/db/migrations-pg']
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) =>
        fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.sql'))
          .map((name) => ({
            name: `${dir}/${name}`,
            sql: fs.readFileSync(path.join(dir, name), 'utf8'),
          })),
      );

  it('has no migration that deletes from or updates admin_actions', () => {
    const offenders = migrationFiles()
      .filter(({ sql }) => /(delete\s+from|update)\s+[`"']?admin_actions/i.test(sql))
      .map(({ name }) => name);

    expect(offenders, `these migrations mutate the log: ${offenders.join(', ')}`).toEqual([]);
  });

  /**
   * SQLite cannot `ALTER TABLE` in place for most changes, so drizzle-kit emits
   * the standard rebuild: create `__new_admin_actions`, copy every row into it,
   * drop the original, rename. `0002_bent_sunset_bain.sql` is exactly that.
   *
   * A rebuild is not a violation — the rows survive it. A rebuild **that
   * forgets the copy** is the violation, and it is indistinguishable from a
   * correct one by eye: both contain `DROP TABLE admin_actions` and both apply
   * without error. The one that silently empties the log is caught here.
   */
  it('copies every row before any migration drops admin_actions', () => {
    const offenders: string[] = [];

    for (const { name, sql } of migrationFiles()) {
      if (!/drop\s+table[^;\n]*[`"']?admin_actions/i.test(sql)) continue;

      const copiesRows =
        /insert\s+into\s+[`"']?__new_admin_actions[`"']?[\s\S]*?select[\s\S]*?from\s+[`"']?admin_actions/i.test(
          sql,
        );
      const dropIndex = sql.search(/drop\s+table[^;\n]*[`"']?admin_actions/i);
      const copyIndex = sql.search(/insert\s+into\s+[`"']?__new_admin_actions/i);

      // The copy must exist and must precede the drop.
      if (!copiesRows || copyIndex < 0 || copyIndex > dropIndex) offenders.push(name);
    }

    expect(
      offenders,
      `these migrations drop the audit log without carrying its rows across: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('exports no update or delete operation from the audit module', () => {
    // The module is the only permitted writer and exposes exactly one write.
    const code = strip(fs.readFileSync(path.normalize('server/services/audit.ts'), 'utf8'));
    const exported = [...code.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]!);

    expect(exported).toContain('appendAdminAction');
    for (const name of exported) {
      expect(name, `audit.ts exports "${name}"`).not.toMatch(/^(update|delete|remove|purge|clear)/i);
    }
  });

  it('wraps every database handle in the guard', () => {
    // A second, unguarded handle would be a way around all of the above.
    for (const file of ['server/db/index.ts', 'server/db/test-db.ts']) {
      const code = strip(fs.readFileSync(path.normalize(file), 'utf8'));
      expect(code, `${file} must wrap its handle in guardAdminActionsWrites`).toMatch(
        /guardAdminActionsWrites\s*\(/,
      );
    }
  });
});
