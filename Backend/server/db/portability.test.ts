/**
 * Enforces `server/db/PORTABILITY.md` mechanically.
 *
 * Every rule in that document is checked here or by the generator it drives.
 * A rule nobody verifies is a rule the codebase drifts away from between one
 * task and the next, and the whole value of the document is that deployment
 * day contains no surprises.
 */

import fs from 'node:fs';
import path from 'node:path';

import { Table, getTableColumns, getTableName, is } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { transform } from '../../scripts/generate-pg-schema';
// Imported statically rather than with a dynamic `await import`: under parallel
// workers the dynamic form intermittently took seconds and tripped the timeout.
import * as pgSchema from './schema-pg/index';
import * as sqliteSchema from './schema/index';

const SCHEMA_DIR = 'server/db/schema';
const PG_DIR = 'server/db/schema-pg';
const CODE_DIRS = ['server', 'shared', 'scripts'];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'migrations' ? [] : walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const schemaFiles = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'));
const allCode = CODE_DIRS.flatMap(walk);

describe('rule 1 — timestamps are ISO-8601 text, never a SQLite date function', () => {
  it('declares no timestamp-mode column', () => {
    for (const file of schemaFiles) {
      const code = stripComments(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
      expect(code, file).not.toMatch(/mode:\s*'timestamp/);
    }
  });

  it('calls no SQLite date or string function anywhere', () => {
    // A bare call, not a method. Zod's `z.string().datetime()` validates an
    // ISO-8601 string in TypeScript and is not a database function; matching
    // it would make this guard noise, and noise is how a guard stops being read.
    const banned =
      /(?<![.\w])(datetime|strftime|julianday|GROUP_CONCAT|JSON_EXTRACT)\s*\(/i;
    for (const file of allCode) {
      if (file.endsWith('portability.test.ts')) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(banned);
      expect(code, file).not.toMatch(/CURRENT_TIMESTAMP/i);
    }
  });
});

describe('rule 2 — booleans are integer 0/1 through a shared helper', () => {
  it('declares no boolean-mode column', () => {
    for (const file of schemaFiles) {
      const code = stripComments(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
      expect(code, file).not.toMatch(/mode:\s*'boolean'/);
    }
  });
});

describe('rule 3 — JSON goes through one serialiser', () => {
  it('declares no json-mode column', () => {
    for (const file of schemaFiles) {
      const code = stripComments(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
      expect(code, file).not.toMatch(/mode:\s*'json'/);
    }
  });
});

describe('rule 4 — no RETURNING-clause assumptions', () => {
  it('calls .returning() nowhere', () => {
    for (const file of allCode) {
      if (file.endsWith('portability.test.ts')) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\.returning\(/);
    }
  });
});

describe('rule 5 — ids are generated in application code', () => {
  it('uses no autoincrement', () => {
    for (const file of schemaFiles) {
      const code = stripComments(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
      expect(code, file).not.toMatch(/autoincrement/i);
    }
  });
});

describe('rule 6 — no synchronous driver-only calls', () => {
  it('calls .all(), .get() or .run() nowhere', () => {
    // These exist only on the better-sqlite3 driver. postgres-js has none of
    // them, so a single call site is a runtime failure on deployment day.
    const banned = /\.(all|get|run)\(\s*\)/;
    for (const file of allCode) {
      if (file.endsWith('portability.test.ts')) continue;
      // The migration comparison tool opens better-sqlite3 *directly* to read
      // the old database alongside the new one. It is the one place that must
      // know both engines at once, it is never imported by the server, and it
      // runs once, by hand, on deployment day. See rule 7 below.
      if (file.endsWith(path.normalize('scripts/compare-row-counts.ts'))) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(banned);
    }
  });

  it('opens no transaction outside the driver-aware file', () => {
    // Drizzle's transaction callback is synchronous on better-sqlite3 and
    // asynchronous on postgres-js. Code using it has to know which engine is
    // running, which is exactly what this document forbids.
    for (const file of allCode) {
      if (file.endsWith('portability.test.ts') || file.endsWith('db/index.ts')) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/\.transaction\(/);
    }
  });
});

describe('rule 7 — only the driver-aware file knows the engine', () => {
  it('imports better-sqlite3 or postgres nowhere else', () => {
    const allowed = new Set(
      [
        'server/db/index.ts',
        'server/db/test-db.ts',
        'server/db/migrate.ts',
        // The third acknowledged exception, added for the Supabase migration.
        // `scripts/compare-row-counts.ts` proves the move worked by counting
        // every table on *both* engines in one process and printing a verdict.
        // It cannot do that through the portable layer, because the portable
        // layer deliberately exposes only one engine at a time. It is a
        // deployment tool: never imported by the server, never reachable from a
        // request, run once by a person.
        'scripts/compare-row-counts.ts',
      ].map((f) =>
        path.normalize(f),
      ),
    );
    for (const file of allCode) {
      // This file names the forbidden imports in order to forbid them.
      if (file.endsWith('portability.test.ts')) continue;
      if (allowed.has(path.normalize(file))) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/from 'better-sqlite3'/);
      expect(code, file).not.toMatch(/from 'postgres'/);
    }
  });

  it('sets PRAGMA nowhere but the driver-aware file', () => {
    for (const file of allCode) {
      if (path.normalize(file) === path.normalize('server/db/index.ts')) continue;
      if (path.normalize(file) === path.normalize('server/db/test-db.ts')) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      expect(code, file).not.toMatch(/pragma\(/i);
    }
  });
});

describe('the Postgres schema is generated, not hand-maintained', () => {
  it('is byte-identical to a fresh generation from the SQLite schema', () => {
    for (const file of schemaFiles) {
      const source = fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8');
      const expected = transform(source, file);
      const actual = fs.readFileSync(path.join(PG_DIR, file), 'utf8');
      expect(actual, `${PG_DIR}/${file} is stale — run scripts/generate-pg-schema.ts`).toBe(
        expected,
      );
    }
  });

  it('mirrors every SQLite schema file', () => {
    expect(fs.readdirSync(PG_DIR).sort()).toEqual(schemaFiles.sort());
  });

  it('declares the same tables and columns in both dialects', () => {
    const describeTables = (mod: Record<string, unknown>) => {
      const out: Record<string, string[]> = {};
      for (const value of Object.values(mod)) {
        if (!is(value, Table)) continue;
        out[getTableName(value)] = Object.keys(getTableColumns(value)).sort();
      }
      return out;
    };

    const a = describeTables(sqliteSchema as unknown as Record<string, unknown>);
    const b = describeTables(pgSchema as unknown as Record<string, unknown>);

    // Guard against a vacuous pass: introspection must actually find tables.
    expect(Object.keys(a).length).toBeGreaterThanOrEqual(46);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const table of Object.keys(a)) {
      expect(a[table]!.length, `${table} has no columns`).toBeGreaterThan(0);
      expect(b[table], `columns differ on ${table}`).toEqual(a[table]);
    }
  });
});
