# Deployment-day runbook — SQLite → Supabase Postgres

Follow top to bottom. Every step has a verification, and every step before step 7 is
reversible by doing nothing. **The local `local.db` is never deleted during this procedure** —
it is the rollback.

Budget about 40 minutes, most of it waiting on Supabase provisioning.

Before starting, confirm the working tree is clean and the suite is green:

```bash
git status --short          # expect no output
npm test                    # expect all tests passing
npx tsc --noEmit            # expect no output
```

---

## 0. Prerequisites

- A Supabase account (free tier). No card required.
- `psql` on PATH, for the verification queries. On Windows it ships with the PostgreSQL
  installer; `winget install PostgreSQL.PostgreSQL` also works.

---

## 1. Create the Supabase project

1. supabase.com → **New project**.
2. Region: **Southeast Asia (Singapore)** — closest to Pakistan of the free-tier regions.
3. Set a strong database password and put it in a password manager now. Supabase does not show
   it again.
4. Wait for provisioning (2–5 minutes).

Then **Project Settings → Database → Connection string → URI**. Copy the **Transaction pooler**
string, port `6543`, not the direct connection on `5432`. The pooler is what suits a serverless
host that opens connections unpredictably (§10.2).

It looks like:

```
postgresql://postgres.abcdefghijklm:YOUR-PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

> **Do not paste this into `.env.example`, into a commit, or into any file that is not
> `.env`.** `.env` is gitignored; `.env.example` holds placeholders only (NFR-4).

---

## 2. Record the source row counts

This is the baseline every later check compares against. Run it **before** touching anything.

```bash
npm run db:verify -- --json > migration-before.json
npm run db:verify
```

Expected output on a reference-only database:

```
▸ sqlite

  area_adjacency          180
  areas                    72
  boards                   10
  cities                    6
  i18n_strings            106
  levels                    7
  provinces                 7
  service_types             5
  subjects                  7
  topic_prerequisites     183
  topics                  202
  …
  TOTAL                   785 rows in 46 tables
```

`migration-before.json` is a scratch file. Do not commit it — add it to `.gitignore` if you
prefer, or delete it at step 9.

---

## 3. Regenerate the Postgres schema mirror and confirm it is not stale

```bash
npm run schema:pg
npm run schema:pg:check
```

Expected: `✓ Postgres schema is in sync with the SQLite schema`.

If `schema:pg` throws, it will name the file and the offending column type, e.g.
`server/db/schema/booking.ts uses mode:'boolean'`. That is a portability rule violation
(`server/db/PORTABILITY.md`) — fix the column, do not hand-patch the generated output.

Commit the regenerated mirror if it changed:

```bash
git add server/db/schema-pg && git commit -m "Regenerate Postgres schema mirror"
```

---

## 4. Generate the Postgres migrations

`SUPABASE_DB_URL` selects the dialect for `drizzle-kit` exactly as it does for the runtime
(`drizzle.config.ts`). Set it for this one command only — do not export it into your shell yet.

```bash
SUPABASE_DB_URL='postgresql://postgres.xxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' \
  npx drizzle-kit generate
```

PowerShell:

```powershell
$env:SUPABASE_DB_URL='postgresql://postgres.xxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres'
npx drizzle-kit generate
```

Expected: `Your SQL migration file ➜ server\db\migrations-pg\0000_*.sql`, listing 46 tables.

Read the generated SQL before applying it. You are looking for: `text`, `integer` and `real`
column types only, no `boolean`, no `jsonb`, no `timestamp`, no `serial`. If any of those
appear, a portability rule has been broken — stop and fix the schema.

```bash
grep -nE '\b(boolean|jsonb|timestamp|serial|bigserial)\b' server/db/migrations-pg/*.sql
# expect no output
```

Commit:

```bash
git add server/db/migrations-pg && git commit -m "Add Postgres migrations"
```

---

## 5. Apply the migrations to Supabase

```bash
SUPABASE_DB_URL='postgresql://...' npm run db:migrate
```

Expected:

```
▸ applying migrations (dialect: postgres, from server/db/migrations-pg)
✓ migrations applied
```

Verify the tables exist and are empty:

```bash
psql 'postgresql://...' -c "select count(*) from information_schema.tables where table_schema='public';"
```

Expected: **47** — the 46 application tables plus Drizzle's `__drizzle_migrations`.

---

## 6. Seed the reference data

Reference data is **re-seeded, not copied**. It is static, it is committed to the repository,
and running the seed is both simpler and safer than exporting and importing rows.

```bash
SUPABASE_DB_URL='postgresql://...' npm run db:seed
```

Expected:

```
▸ validating reference data
▸ seeding reference data
  provinces                7
  cities                   6
  areas                   72
  …
✓ reference data seeded and verified against the database
```

The seed validates before it writes (cycle check on the prerequisite graph, adjacency symmetry,
i18n completeness) and counts rows back out of the database afterwards. If it aborts, nothing
partial was left behind that a re-run will not fix — the seed clears and rewrites.

### If there is real user data to move

There is none during development, and there should be none before launch. If there ever is,
do **not** hand-write an export: add a script that reads through the repository layer and
writes through it, so the boundary translation in `shared/db-values.ts` is applied on both
sides. A raw `.dump` from SQLite will not import cleanly, because SQLite emits its own
dialect's DDL.

---

## 7. Verify row counts, table by table

```bash
SUPABASE_DB_URL='postgresql://...' npm run db:verify -- --json > migration-after.json
npx tsx scripts/verify-row-counts.ts --compare migration-before.json migration-after.json
```

Expected:

```
table                   source    target
────────────────────────────────────────
admin_actions                0         0  ✓
area_adjacency             180       180  ✓
areas                       72        72  ✓
…
✓ all 46 tables match
```

**If any row shows `✗ MISMATCH`, do not cut over.** Go to step 10.

Then check the data is not merely present but correct, by walking the prerequisite graph
against the new database — the §2.4 worked example, end to end:

```bash
SUPABASE_DB_URL='postgresql://...' npx tsx scripts/print-prereq-chain.ts
```

Expected: the six-topic chain ending
`Algebraic Factorisation → Quadratic Equations`, with the Urdu names rendering correctly. If
the Urdu is mangled, the connection is not UTF-8 — stop and investigate before cutting over.

Finally, confirm the boolean and JSON helpers behave against Postgres by running the smoke
test with the production URL set:

```bash
SUPABASE_DB_URL='postgresql://...' npm test -- server/repositories/repositories.smoke.test.ts
```

> Note: the smoke test builds its own in-memory SQLite database, so this run proves the
> repositories still compile and pass, not that they ran against Postgres. To exercise Postgres
> directly, point `createSeededTestDb` at the production `db` in a scratch branch — and use a
> throwaway Supabase project, never the live one.

---

## 8. Point the deployment at Supabase

Set the environment variable in the host, not in a file:

- **Netlify** → Site configuration → Environment variables → `SUPABASE_DB_URL`
- **Vercel** → Project → Settings → Environment Variables → `SUPABASE_DB_URL` (Production)

Also set, per `.env.example`: `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN`,
`JWT_SECRET`, `CNIC_HASH_SALT`, `ADDRESS_ENCRYPTION_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `CORS_ORIGIN`.

Deploy, then check the health endpoint and one real read:

```bash
curl -s https://YOUR-SITE/api/health
```

---

## 9. Clean up

```bash
rm migration-before.json migration-after.json
```

Confirm nothing sensitive was committed:

```bash
git status --short
git log --oneline -5
grep -rn 'pooler.supabase.com' --include='*.ts' --include='*.md' --include='*.json' . \
  | grep -v node_modules | grep -v 'scripts/migrate-to-supabase.md'
# expect no output
```

Open the repository in a private browsing session and confirm no `.env`, no `.db`, no
connection string (NFR-13).

---

## 10. Rollback

Nothing in steps 1–7 touches the local database or the deployed site, so rollback before
step 8 is: **stop, and unset `SUPABASE_DB_URL`.** Development continues on SQLite unchanged.

```bash
unset SUPABASE_DB_URL          # PowerShell:  Remove-Item Env:\SUPABASE_DB_URL
npm run db:verify              # confirms you are back on sqlite
```

If you have already completed step 8 and the deployed site is failing:

1. **Remove `SUPABASE_DB_URL` from the host's environment variables and redeploy.** The
   application falls back to the SQLite branch. On a serverless host this means an ephemeral,
   empty database — the site will run and read reference data but will not persist writes.
   That is a degraded state, not a working one; it buys time, it is not a destination.
2. Diagnose against a *second*, throwaway Supabase project rather than the live one.
3. To start the Supabase side over from scratch:

   ```bash
   SUPABASE_DB_URL='postgresql://...' psql "$SUPABASE_DB_URL" \
     -c 'drop schema public cascade; create schema public;'
   ```

   Then re-run steps 5 and 6. This destroys every row in the Supabase database — it is safe
   only while the sole contents are re-seedable reference data. Once there is real user data,
   restore from a Supabase backup instead (Project → Database → Backups).

4. If the failure is a schema-level incompatibility, it will be a violated rule in
   `server/db/PORTABILITY.md`. `npm test` runs the portability suite; start there rather than
   hand-patching the generated Postgres schema.

---

## Quick reference

| Step | Command |
|---|---|
| Baseline counts | `npm run db:verify -- --json > migration-before.json` |
| Regenerate mirror | `npm run schema:pg && npm run schema:pg:check` |
| Generate PG migrations | `SUPABASE_DB_URL=... npx drizzle-kit generate` |
| Apply | `SUPABASE_DB_URL=... npm run db:migrate` |
| Seed | `SUPABASE_DB_URL=... npm run db:seed` |
| Verify | `SUPABASE_DB_URL=... npm run db:verify -- --json > migration-after.json` |
| Compare | `npx tsx scripts/verify-row-counts.ts --compare migration-before.json migration-after.json` |
| Spot-check | `SUPABASE_DB_URL=... npx tsx scripts/print-prereq-chain.ts` |
| Roll back | unset `SUPABASE_DB_URL`, redeploy |
