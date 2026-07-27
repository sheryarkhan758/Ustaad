import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * One config, two dialects, selected by the same variable that selects the
 * runtime driver: `SUPABASE_DB_URL` (see `server/db/index.ts`).
 *
 * The Postgres schema in `server/db/schema-pg/` is generated from the SQLite
 * one — never hand-edited. Regenerate before generating Postgres migrations:
 *
 *   npx tsx scripts/generate-pg-schema.ts
 *
 * Migrations are kept in separate folders per dialect because the emitted SQL
 * differs even though the schema does not.
 */
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

export default SUPABASE_DB_URL
  ? defineConfig({
      schema: './server/db/schema-pg/*.ts',
      out: './server/db/migrations-pg',
      dialect: 'postgresql',
      dbCredentials: { url: SUPABASE_DB_URL },
      strict: true,
      verbose: true,
    })
  : defineConfig({
      schema: './server/db/schema/*.ts',
      out: './server/db/migrations',
      dialect: 'sqlite',
      dbCredentials: { url: process.env.DATABASE_URL ?? 'file:./local.db' },
      strict: true,
      verbose: true,
    });
