# Deployment — Netlify and Supabase Postgres

The staged decision in §10.2 coming due: development ran on a local SQLite file, production
runs on Supabase Postgres, selected by the presence of one environment variable.

**Status: prepared and verified as far as it can be without credentials. Not yet deployed.**

Everything that can be built and checked from this repository has been. Four steps require
credentials and an interactive login that only the project owner has — creating the Supabase
project, setting Netlify environment variables, running the migration against the live
database, and the post-deployment checks against the live URL. Those are marked
**[NEEDS YOU]** below, with the exact command to run.

Nothing in this document claims a check passed that has not been run. That distinction is the
document's main value.

---

## 1. What was built

| Artefact | Purpose |
|---|---|
| `netlify/functions/api.ts` | The whole Express app behind one Netlify Function |
| `netlify.toml` | `/api/*` → the function; SPA fallback; security headers |
| `server/db/migrations-pg/0000_milky_vivisector.sql` | **Generated** Postgres DDL — 947 lines, 48 tables |
| `scripts/compare-row-counts.ts` | Reads both databases and prints a table-by-table verdict |
| `scripts/scan-bundle-secrets.ts` | Greps the built client for the **value** of every secret |
| `scripts/post-deploy-check.ts` | The six post-deployment checks, executed against the live URL |

New commands:

```
npm run db:compare      # SQLite vs Postgres row counts
npm run scan:bundle     # secret values in client/dist
npm run verify:deploy   # post-deployment checks against a URL
```

### The function is one handler, not one per route

Routing already exists inside Express. A second route table in `netlify.toml` would be one
more thing to keep in step with the first, and the failure mode — a route that works locally
and 404s in production — is tedious to diagnose.

### Cold-start discipline

`netlify/functions/api.ts` does exactly two things at module scope: import `db`, which opens
the postgres-js pool, and build the Express app. Both are then reused for every invocation
the container serves.

It deliberately does **not**:

- **migrate** — two overlapping cold starts would race with no lock to arbitrate;
- **seed** — `db:seed:demo` writes invented people with a published password and refuses
  Postgres outright;
- **schedule jobs** — `server/jobs/` are the only writers of the materialised tables (§2.8).
  A `setInterval` here runs once per warm container, which is N uncoordinated writers rather
  than one scheduled job.

The jobs need a Netlify scheduled function or an external cron. **That is outstanding** — see
§7.

---

## 2. The dialect move: what broke, and what did not

The honest headline: **the DDL generated clean on the first attempt.** That is the portability
discipline in `server/db/PORTABILITY.md` paying for itself, not luck. The generated Postgres
schema contains no `AUTOINCREMENT`, no `rowid`, no `jsonb`, no `CURRENT_TIMESTAMP`, no
`datetime()`, no `serial`, and no column type outside `text`, `integer` and `real`:

```
$ grep -niE "autoincrement|rowid|datetime\(|strftime|julianday|current_timestamp|jsonb|serial" \
    server/db/migrations-pg/0000_milky_vivisector.sql
(no matches)
```

Four genuine divergences were found by audit. Each is now a numbered rule in
`PORTABILITY.md` so it cannot recur, and **none was fixed with a raw SQL escape hatch in a
route handler** — the constraint the task set.

| # | Divergence | Verdict | Where it is now written down |
|---|---|---|---|
| 1 | `inArray(col, [])` → Postgres rejects `IN ()` as a syntax error; SQLite accepts it | **Already safe.** The pinned Drizzle emits `sql\`false\`` for an empty array — verified in `node_modules/drizzle-orm/sql/expressions/conditions.js`. The rule is that hand-writing the predicate is what breaks, so it must stay a builder call | PORTABILITY rule 9 |
| 2 | `count(*)` is `bigint` in Postgres, so postgres-js returns a **string**; better-sqlite3 returns a number | **Already handled** — `server/db/queries/count-rows.ts` wraps in `Number(...)`. Written down because a count used directly in arithmetic would concatenate on one engine and add on the other: `"5" + 1` is `"51"` | PORTABILITY rule 10 |
| 3 | Text collation: SQLite compares `BINARY`, Supabase Postgres is locale-aware, so `ORDER BY name` can differ | **Already safe** — every `orderBy` in the codebase ends with a unique column, usually `id`, so the total order is deterministic regardless of collation. The rule is to keep it that way | PORTABILITY rule 11 |
| 4 | `LIKE` is case-insensitive for ASCII on SQLite and case-sensitive on Postgres | **Not fixed, deliberately.** The only `LIKE` in the codebase is in `server/db/seed/demo/index.ts`, which refuses to run when `SUPABASE_DB_URL` is set. Application code normalises email to lower case and compares with `eq`. If that refusal is ever relaxed, this becomes a real bug | PORTABILITY rule 12 |

### The one that actually broke: rate limiting

This is the finding that justifies building the wrapper before deployment day rather than
during it. Invoking the handler with a Lambda-shaped event threw:

```
ERR_ERL_UNDEFINED_IP_ADDRESS
```

Behind a Netlify Function the request reaches Express through an event object rather than a
socket, so `req.ip` is `undefined` and `express-rate-limit` refuses to key a bucket.

**Every limiter would have been broken in production while passing every local test** — the
login endpoint included, which is the one that most needs limiting. Bcrypt at cost 12 makes
each login attempt cost ~250 ms of server CPU, so an unlimited login endpoint on a free tier
is a denial-of-service surface as much as a credential-stuffing one.

Fixed in `server/middleware/rate-limit.ts` with a shared `clientKey` resolver used by all
three limiters: `x-nf-client-connection-ip` (set by Netlify's edge from the real TCP
connection, and not forgeable — the edge overwrites it), then the first hop of
`x-forwarded-for`, then `req.ip`. The final fallback is the literal `'unknown'`, so callers
the platform cannot identify share one bucket and are limited **collectively rather than not
at all** — failing closed is the right direction for a control on a credential endpoint.

Verified against all three header shapes through the actual handler.

A fifth was recorded pre-emptively: **do not start using `.returning()` now that production is
Postgres** (rule 13). Development still runs SQLite, so it would be a query the local suite
exercises on the other engine, and ids are generated before the insert anyway.

### What has *not* been proven

The DDL has been generated and statically audited. **It has not been applied to a real
Postgres instance**, because none was reachable from this environment — Docker is installed
but its daemon was not running, and no `psql` is on the path.

So runtime dialect behaviour is argued from the pinned driver source and the schema rules,
not observed. The first `npm run db:migrate` against Supabase is therefore the real test.
Expect it to work; do not assume it.

---

## 3. Migration to Supabase **[NEEDS YOU]**

Follow `scripts/migrate-to-supabase.md`. In short:

```bash
# 1. Create the Supabase project, then take the connection string.
#    Use the SESSION pooler (port 5432) for migrations — the transaction
#    pooler on 6543 cannot run DDL reliably.
export SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres'

# 2. Confirm the mirror is current, then apply.
npm run schema:pg:check
npm run db:migrate            # branches on SUPABASE_DB_URL automatically

# 3. Seed reference data. Never the demo seed — it refuses anyway.
npm run db:seed

# 4. Verify, table by table.
npm run db:compare
```

`npm run db:compare` prints a row per table with a verdict. It reads reference and user
tables differently, on purpose:

- **Reference tables must match exactly.** Both sides are seeded from the same committed
  files, so a difference means a seed failed partway or ran twice.
- **User tables are expected to be empty.** Local user data is development data and does not
  migrate — it is invented people in a file that never enters the repository (§2.2). A
  *non-empty* user table on a fresh production database is the thing to stop and look at.

Expected reference counts: provinces 7, cities 6, areas 72, area_adjacency 180, subjects 7,
levels 7, boards 10, topics 202, topic_prerequisites 183, service_types 5, i18n_strings 106.

**Runtime connection string.** After migrating, switch `SUPABASE_DB_URL` on Netlify to the
**transaction** pooler (port 6543). `server/db/index.ts` already opens postgres-js with
`prepare: false` and a small `max` for exactly that pooler — prepared statements break on it
because it does not hold a session across statements.

---

## 4. Environment variables **[NEEDS YOU]**

Set on Netlify under *Site configuration → Environment variables*. Scope them to
**Functions** — anything scoped to the build is visible to the client build step.

| Variable | Notes |
|---|---|
| `SUPABASE_DB_URL` | Transaction pooler, port **6543**. Its presence is what selects Postgres. |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-side only.** Bypasses row-level security. |
| `SUPABASE_STORAGE_BUCKET` | `ustaad-private-documents` |
| `JWT_SECRET` | Long random. Rotating it logs everybody out. |
| `CNIC_HASH_SALT` | Long random. **Rotating it breaks duplicate detection for every existing hash.** |
| `ADDRESS_ENCRYPTION_KEY` | 32-byte hex. **Rotating it makes every stored address permanently unreadable** (SEC-3). |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | Optional — every AI path has a non-AI fallback (NFR-11) |
| `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` | The three SEC-25 permits in client code |
| `EMAILJS_PRIVATE_KEY` | Optional strict-mode token. **Not** a mail password. |
| `COOKIE_SECURE=true`, `NODE_ENV=production`, `CORS_ORIGIN=<site URL>` | |

**Never prefix a secret with `VITE_`.** Vite inlines anything so prefixed into the client
bundle by design. `VITE_GEMINI_API_KEY` instead of `GEMINI_API_KEY` is one character between
a server-side key and a key published to every visitor.

### Proving no secret is in the bundle **[NEEDS YOU]**

```bash
npm run build:client
npm run scan:bundle
```

This greps the built output for the **value** of each secret, not the variable name — a build
that inlined `JWT_SECRET` would not contain the string "JWT_SECRET", it would contain the
secret. Any hit exits non-zero.

Variables not present in the shell are reported **`NOT VERIFIED`**, not as passes. Run it with
the production values loaded, or the report is about your laptop rather than the deployment.
`scripts/post-deploy-check.ts` additionally fetches the *served* bundle and looks for
credential shapes — Postgres URLs, service-role JWTs, `AIza…` and `gsk_…` keys.

---

## 5. Private storage bucket **[NEEDS YOU]**

In Supabase → Storage, create `ustaad-private-documents` with **Public bucket OFF**. Add no
public read policy. Access is by short-lived signed URL only, issued server-side and logged
before issue (SEC-7, NFR-9).

Verify it is actually private:

```bash
curl -i "https://<project>.supabase.co/storage/v1/object/ustaad-private-documents/tutor-documents/probe.pdf"
```

A **400/401/403/404 is the pass** — any refusal. A **200 is the failure**: it means the bucket
is public and every CNIC image is world-readable. `npm run verify:deploy` performs this check
and reports `STATUS 200 — THE BUCKET IS PUBLIC` if so.

---

## 6. Post-deployment verification **[NEEDS YOU]**

```bash
npx tsx scripts/post-deploy-check.ts https://<your-site>.netlify.app
```

| Check | What it proves |
|---|---|
| Health + address encryption configured | The function boots and `ADDRESS_ENCRYPTION_KEY` is set — without it a booking cannot store an address at all |
| Login for all five roles | Parent, tutor, student, organisation, admin |
| Session cookie is `httpOnly` **and** `Secure` | §2.11 in production, not just in the code |
| Female-only home search returns verified tutors | The primary use case, and that the hard filter did not leak a male tutor |
| One booking through to completion | A completed engagement is readable by its owner |
| AI conversation replays with zero live calls | FR-15.7 — the demonstration cannot be taken down by a rate limit |
| Live AI agent degrades rather than errors | NFR-11 — a 4xx is a refusal, a 5xx is a crash |
| Volunteer application accepted, mail outcome recorded | FR-33.9 — the row is written before the mail, and `skipped` is reported honestly when EmailJS is unconfigured |
| Feedback lands in the admin queue | Submitted anonymously, then found in the queue as an administrator |
| Private bucket refuses an unsigned fetch | SEC-7, SEC-24 |
| No credential pattern in the served bundle | NFR-5, SEC-12 |

Checks that cannot run — no demo accounts in production, `SUPABASE_URL` not set locally —
report **`SKIP` with the reason** and are listed separately at the end. A skipped check that
printed a tick would be worse than no check.

Note that production will have **no demonstration accounts** unless you deliberately seed
them, and `db:seed:demo` refuses Postgres. Three checks will therefore skip on a clean
production database. That is correct: production should not contain invented people with a
password published in the README.

### The repository history check **[NEEDS YOU]**

Not automatable from inside the repository — it needs a fresh clone in a private window:

```bash
git log --all --full-history -- .env '*.db' 'local.db*' uploads/
git rev-list --all | xargs -I{} git grep -lE "AIza[0-9A-Za-z_-]{35}|gsk_[0-9A-Za-z]{40}|postgres://" {} 2>/dev/null | head
```

Both should return nothing. Then open the GitHub URL in a private browsing session and
confirm no `.env`, no `.db` file and no `uploads/` directory is present.

Currently verified locally: `.env` and `local.db*` are gitignored and untracked.

---

## 7. Outstanding

Recorded rather than quietly omitted.

1. **The materialisation jobs have no production schedule.** `server/jobs/` must run
   periodically or `tutor_scores`, `tutor_reliability` and `rate_benchmarks` go stale — search
   would keep returning results, ranked on old signals, which is the worst kind of broken
   because nothing looks broken. Needs a Netlify scheduled function or an external cron
   calling a protected endpoint.
2. **`/client` is empty.** `netlify.toml` points `publish` at `client/dist` and
   `build:client` at `vite build client`. Until the client exists, deploy with the build
   command set to `echo "no client yet"` and `publish` to a directory containing a placeholder
   `index.html`, or the build fails. The API and its function deploy independently of this.
3. **The DDL has not been applied to a real Postgres.** See §2.
4. **`docs/SECURITY_REVIEW.md` lists four Partial controls**, all partial because the client
   does not exist — SEC-4, SEC-10, SEC-23 and part of SEC-6 describe screens. Deploying does
   not change their status.

---

## Rollback

`SUPABASE_DB_URL` is the switch, in both directions. Unset it and the process talks to the
local SQLite file again; no code changes, no redeploy of anything but the variable.

Supabase keeps automatic backups on the free tier. Before any destructive migration, take one
manually — Database → Backups. The rollback step for a bad migration is to restore, not to
write a down-migration: `admin_actions` is append-only (§2.7, NFR-19), and a down-migration
that dropped it would destroy the verification chain of custody.
