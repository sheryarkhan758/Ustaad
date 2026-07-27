// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/index.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema barrel.  Drizzle Kit reads `server/db/schema/*.ts` directly (see
 * drizzle.config.ts); this file exists so application code has one import.
 *
 * Order follows the data model in docs/DATA_MODEL.md: reference data first,
 * then identity, then everything that hangs off them.
 */

export * from './reference';
export * from './identity';
export * from './auth';
export * from './tutor';
export * from './verification';
export * from './booking';
export * from './payment';
export * from './feedback';
export * from './ai';
export * from './matching';
export * from './admin';
export * from './derived';
export * from './platform';
