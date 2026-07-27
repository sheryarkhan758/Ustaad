# Deploying Ustaad.com

Netlify serves the PWA and one Function; Supabase provides Postgres and the
private document bucket. Both sit inside a permanent free tier, which §12 of
the specification requires.

**SQLite is development only.** Netlify Functions run on an ephemeral
filesystem — a `local.db` there would either be read-only or would accept
writes that vanish when the container is recycled. `SUPABASE_DB_URL` is the
single switch that moves the whole application onto Postgres
(`Backend/server/db/index.ts` is the only file that knows which engine is
running).

---

## 1. Supabase — **[NEEDS YOU]**

1. Create a project at <https://supabase.com>. Any region; pick the one nearest
   Pakistan for latency.
2. **Settings → Database → Connection string → Transaction pooler**, port
   **6543**. Copy it. The pooler matters: `server/db/index.ts` opens
   postgres-js with `prepare: false` precisely because transaction mode does
   not hold a session across statements, and a serverless platform opens
   containers unpredictably.
3. **Storage → New bucket**, named `ustaad-private-documents`, and leave
   **Public** switched **off**. This holds CNIC images and academic documents;
   they are served only through short-lived signed URLs to administrators, and
   every access is logged (SEC-7, NFR-9).

## 2. Create the schema

From `Backend/`, with the connection string exported:

```bash
export SUPABASE_DB_URL="postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres"
npm run db:migrate     # creates all 55 tables
npm run db:seed        # reference data only: locations, subjects, topics, boards
```

`db:seed` is reference data — provinces, cities, areas, subjects, levels,
boards, topics, prerequisite edges, exam windows. It contains no user
information and is safe to run against production.

**Do not run `db:seed:demo` against Supabase.** It writes invented people with
a published password; it refuses to run when `SUPABASE_DB_URL` is set, and that
refusal is deliberate (FR-15.9).

## 3. Netlify — **[NEEDS YOU]**

1. **Add new site → Import an existing project → GitHub →** this repository.
2. Netlify reads `netlify.toml` at the root. Leave every build setting at its
   default — the file already declares the base, the command, the publish
   directory and the functions directory. If the UI pre-fills something
   different, clear it; a UI value overrides the file.
3. **Site configuration → Environment variables.** Set these:

| Variable | Value |
|---|---|
| `SUPABASE_DB_URL` | the pooler connection string from step 1 |
| `SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → `service_role` |
| `SUPABASE_ANON_KEY` | Settings → API → `anon` |
| `SUPABASE_STORAGE_BUCKET` | `ustaad-private-documents` |
| `JWT_SECRET` | a long random string — `openssl rand -base64 48` |
| `NODE_ENV` | `production` |
| `COOKIE_SECURE` | `true` |
| `COOKIE_DOMAIN` | your Netlify domain, e.g. `ustaad.netlify.app` |
| `CORS_ORIGIN` | the same domain, with `https://` |
| `GEMINI_API_KEY` | optional — see below |
| `GROQ_API_KEY` | optional — see below |

**None of these may carry a `VITE_` prefix.** Vite inlines any `VITE_*`
variable into the browser bundle, so a prefixed service-role key would be
published to every visitor. `Backend/scripts/scan-bundle-secrets.ts` checks the
built output for each value and fails on a match.

### The AI keys are optional

With neither key set, `server/ai/provider.ts` falls through to a heuristic
classifier that needs no network. Every AI path then degrades to the manual
route with an explanation rather than an error (NFR-11), and the five recorded
demonstration scenarios at `/demo` work regardless — they replay stored
sessions and contact no provider at all.

## 3b. Create the administrator — **[NEEDS YOU]**

There is no administrator on a fresh deployment, and no way to register one:
`REGISTERABLE_ROLES` is `parent | student | tutor | organisation`, and `admin`
is absent **by construction** rather than by a check that could be forgotten
(FR-1.5). `db:seed:demo` would create one, but it refuses to run against
Supabase — deliberately, because it publishes a password (FR-15.9).

So an administrator is created by somebody who already holds the database,
which is the correct bar for an account that can approve verifications,
resolve payment disputes and request the disclosure of a family's address:

```bash
cd Backend
SUPABASE_DB_URL="postgresql://..." ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD='choose-a-long-one' ADMIN_NAME="Your Name" npm run create-admin
```

**The password is read from the environment and never written to this
repository.** Not as a CLI argument either — arguments land in shell history
and in the process list. The script refuses a password under 12 characters,
refuses the published demonstration password, and never prints it back.

Re-running with an existing administrator email **resets that password** and
bumps `tokenVersion`, signing out every session it had. That is the right
behaviour for a credential you are resetting because it may be compromised.

## 4. Verify — after the first deploy

```bash
cd Backend
BASE_URL=https://your-site.netlify.app npx tsx scripts/post-deploy-check.ts
npm run scan:bundle          # confirms no secret reached the client bundle
```

Then by hand, because these are the ones that matter:

- `/` loads and the language toggle flips the layout right-to-left.
- `/search` returns tutors; a **female-only** search returns only female
  tutors — the exclusion is in the SQL predicate, not the ranking (§2.4).
- `/demo` replays a scenario turn by turn and reports `liveModelCalls: 0`.
- Fetch a storage object path directly in a browser and confirm **403**. The
  bucket is private; a 200 here means step 1.3 was missed.

## 5. Ongoing: the materialisation jobs

`tutor_scores`, `tutor_reliability` and `rate_benchmarks` are written **only**
by `npm run jobs` (§2.8). They are not scheduled by the Function — a
`setInterval` there would run once per warm container, which is N uncoordinated
writers rather than one job.

Run them manually after seeding, and schedule them later via a Netlify
scheduled function or an external cron:

```bash
SUPABASE_DB_URL="..." npm run jobs
```

Until they run, search still works but every derived statistic reads zero.

---

## If the build fails

| Symptom | Cause |
|---|---|
| `Cannot find module '@shared/...'` | The base is not the repository root, so the npm workspace link was never created. Clear any base override in the Netlify UI. |
| `vite: not found` | `NPM_FLAGS = "--include=dev"` was dropped from `netlify.toml`. Netlify sets `NODE_ENV=production`, which skips devDependencies. |
| A `.node` binary error | `better-sqlite3` entered the Function bundle. It is listed in `external_node_modules` and must stay there. |
| `Cannot find module @rollup/rollup-linux-x64-gnu` | npm's optional-dependency bug (npm/cli#4828). A lockfile resolved on Windows records only the win32 binary, so `npm ci` on Linux has nothing to install. `Frontend/package.json` declares the Linux binary as an **optionalDependency** to force a real lockfile entry — do not remove it. It is `optional` so a Windows install skips it rather than failing. |
| `relation "..." does not exist` | Step 2 was skipped, or run against a different database than `SUPABASE_DB_URL` points at. |
