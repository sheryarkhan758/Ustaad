# Portability rules — SQLite now, Supabase Postgres on deployment

Development runs against a local SQLite file. Production runs against Supabase Postgres
(specification §10.2). This file lists the concrete rules that keep the move between them a
**configuration change rather than a rewrite**, and says where each one is enforced.

Every rule below is checked mechanically by `server/db/portability.test.ts`. A rule nobody
verifies is a rule the codebase drifts away from between one task and the next.

```
npm test              # includes the portability suite
npm run schema:pg     # regenerate the Postgres schema mirror
npm run schema:pg:check   # fail if the mirror is stale
```

---

## The one idea everything else follows from

**Every column is `text`, `integer` or `real`. Nothing else.**

Those three builders have identical signatures and identical semantics in
`drizzle-orm/sqlite-core` and `drizzle-orm/pg-core`. So the two schema trees differ by exactly
one import line per file, and `server/db/schema-pg/` is *generated* from `server/db/schema/`
by `scripts/generate-pg-schema.ts` rather than hand-maintained.

Anything richer — a boolean type, a JSON type, a timestamp type — is precisely where the two
engines diverge. Those are handled in TypeScript, on values, in `shared/db-values.ts`.

---

## Rule 1 — Timestamps are ISO-8601 UTC text, never a database date function

Stored as `text` in the form `2026-07-26T05:16:16.123Z`: always UTC, always millisecond
precision, always 24 characters.

| | |
|---|---|
| **Write** | `nowIso()` or `toDbTimestamp(date)` |
| **Read** | `fromDbTimestamp(value)` |
| **Column** | `createdAt()` / `timestampCol(name)` in `server/db/schema/_common.ts` |

Fixed width is the point: lexicographic ordering of this format *is* chronological ordering,
so `ORDER BY created_at` and `WHERE created_at > ?` behave identically on both engines with no
cast and no function call.

Text rather than integer epoch because Postgres `integer` is four bytes and epoch milliseconds
overflow it — 1.7 × 10¹² against a 2.1 × 10⁹ ceiling. Storing epoch would force `bigint` on one
side and `integer` on the other, which is a dialect-specific column type and therefore the
thing this document exists to prevent. It also reads correctly in `psql` without conversion,
which matters on deployment day.

**Banned outright:** `datetime()`, `date()`, `strftime()`, `julianday()`, `CURRENT_TIMESTAMP`,
and any database-side `DEFAULT` for a timestamp. Every default is `$defaultFn`, which runs in
JavaScript. The clock belongs to the application.

Dates a *user* supplies — a date of birth, an exam date — are ISO `YYYY-MM-DD` text and are
compared in TypeScript. Times of day are zero-padded `HH:MM` text, whose lexicographic order is
also its chronological order.

## Rule 2 — Booleans are integer 0/1 through a shared helper

| | |
|---|---|
| **Write** | `toDbBool(value)` → `0` or `1` |
| **Read** | `fromDbBool(value)` → `boolean` |
| **Column** | `boolCol(name)` — a plain `integer` |

SQLite has no boolean type and will happily store `'yes'`, `'true'` or `'Y'` in a column you
are treating as a flag. Postgres has a real `boolean` and rejects all three. A codebase that
drifts into truthy text discovers it on migration day, one column at a time.

Drizzle's `integer(..., { mode: 'boolean' })` is **not** used, because its Postgres counterpart
is a genuine `boolean` column — a different storage type, and therefore a schema that no longer
generates cleanly.

`fromDbBool` is strict: anything that is not `0` or `1` throws. Reading a stray value as `true`
because it happens to be truthy would hide the corruption this rule exists to prevent.

## Rule 3 — JSON is written and read through one serialiser

| | |
|---|---|
| **Write** | `toDbJson(value)` |
| **Read** | `fromDbJson<T>(value)` / `fromDbJsonArray(value)` |
| **Column** | `jsonCol(name)` — a plain `text` |

Postgres `jsonb` is genuinely better: it indexes, it queries, it validates. It is deliberately
not used, because using it would mean either writing `jsonb` operators SQLite cannot run, or
maintaining two query paths.

The column is a serialised blob the application parses. **No query ever reaches inside it** —
no `JSON_EXTRACT`, no `->>`, no `@>`. If a value needs to be filtered or sorted on, it belongs
in its own column.

`undefined` and `null` both store as SQL NULL rather than the string `"null"`: a column that is
absent and a column containing JSON null are different things, and only one of them survives a
round trip cleanly.

## Rule 4 — No RETURNING-clause assumptions

**`.returning()` is called nowhere in this codebase.**

Ids are generated in application code (rule 5), so a write knows its id before it happens.
Repositories therefore insert with a known id and select by it — two statements, no dependency
on what the engine hands back.

Drizzle exposes `.returning()` on both drivers, but the underlying guarantees are not the same:
SQLite's `RETURNING` has documented interactions with triggers and does not guarantee row order
for multi-row statements. Code that grows to depend on either is expensive to unpick later, and
nothing is gained here, because the id was never in doubt.

## Rule 5 — Ids are generated in application code

Every primary key is `text`, holding a UUID from `newId()` (`node:crypto.randomUUID`).
Reference tables use stable hand-authored slugs instead — `sindh`, `karachi-clifton`,
`math-matric-sindh-quadratic-equations` — which are equally application-supplied.

**No `AUTOINCREMENT`. No `rowid`. No `last_insert_rowid()`. No Postgres sequence.**

Engine-generated ids are the single most expensive thing to migrate: the semantics differ, the
recovery of the generated value differs, and a sequence left behind after a bulk import
silently collides on the next insert. Generating in application code also means an id exists
before the row does, which is what makes rule 4 free.

## Rule 6 — No driver-only calls, and no transactions outside the driver-aware file

**Banned:** `.all()`, `.get()`, `.run()`. These exist only on the better-sqlite3 driver;
postgres-js has none of them, so a single call site is a runtime failure on deployment day.
Always `await` the query builder — that form works on both.

This one has already cost us once. Removing `.run()` from statements inside a synchronous
`db.transaction()` callback left the builders lazy, so the seed silently wrote nothing while
still printing a clean summary. The summary was counting the seed constants rather than the
database. `server/db/seed/index.ts` now counts rows read back out of the database and fails if
they disagree.

**Also banned outside `server/db/index.ts`:** `db.transaction()`. Drizzle's transaction callback
is synchronous on better-sqlite3 and asynchronous on postgres-js, so any code using it has to
know which engine is running. Where atomicity is genuinely needed, that is a decision to make
deliberately at the point it is needed, not a habit spread through the codebase.

## Rule 7 — Exactly one file knows which engine is running

`server/db/index.ts` selects the driver on the presence of `SUPABASE_DB_URL` and exports `db`.
No other module imports `better-sqlite3` or `postgres`. (`test-db.ts` and `migrate.ts` are the
two acknowledged exceptions — one builds an in-memory database for tests, the other runs a
driver-specific migrator.)

`PRAGMA` appears only in that file, setting `foreign_keys = ON` (SQLite ships it off; Postgres
cannot turn it off — the pragma is what makes the two agree) and `journal_mode = WAL`. Both are
connection settings with no query semantics.

## Rule 8 — Route handlers call repositories, never `db`

`server/repositories/` is the only layer that builds queries. That confines the set of SQL this
application can emit to something small enough to review in one sitting, and gives a query that
might behave differently across engines exactly one place it can be written.

Repositories also translate at the boundary: a caller receives `boolean`, `Date`, arrays and
objects, never a `0` that means `false` or a string that means an array.

---

## Money and numbers

Money is **integer paisa** (1 PKR = 100 paisa) in every monetary column, never a float and
never a decimal string. Floats drift under repeated arithmetic and round differently across the
two engines. Postgres `integer` tops out at 2,147,483,647 paisa — PKR 21.4 million — far above
any rate, benchmark or cycle amount this platform records; aggregate totals are computed in
TypeScript and never stored, so the ceiling is not reachable by accumulation.

Scores, rates and ratios are `real`, because they are computed quantities rather than currency
and a fractional confirmation rate is meaningful where a fractional rupee is not.

## Text

Columns holding user text accept the full Unicode range in both engines. Urdu script, Roman
Urdu, English and any mixture are stored byte-for-byte as entered and never normalised,
transliterated or machine-translated (CLAUDE.md §2.10).

Do not rely on SQLite's `LIKE` being case-insensitive for ASCII — it is, and Postgres's is not.
Use `ILIKE`-free explicit lower-casing in application code, or an indexed column.

---

## What is *not* portable, and is therefore accepted as migration work

Being honest about the residue is part of the point:

| Item | Why | Cost on the day |
|---|---|---|
| `server/db/schema-pg/` | Drizzle table builders are dialect-specific | None — generated, and drift-tested |
| `server/db/migrations-pg/` | Emitted SQL differs even though the schema does not | One `drizzle-kit generate` |
| The migrator import in `migrate.ts` | Driver-specific by nature | Already branched |
| The `db` type cast in `index.ts` | Two distinct Drizzle types | Sound *because* both schemas declare identical columns; the drift test is what keeps it sound |
| Reference data | Must be re-seeded, not copied | `npm run db:seed` against the new URL |

The runbook for all of it is `scripts/migrate-to-supabase.md`.

---

## Rules added during the Supabase migration

Each of these was found while preparing the Postgres move. They are written down so the
same thing cannot be reintroduced quietly. `docs/DEPLOYMENT.md` records what surfaced and
what it cost.

### Rule 9 — `inArray` with a possibly-empty array is safe, and must stay a builder call

`inArray(column, [])` emits `false` in the pinned Drizzle version rather than the `IN ()`
that Postgres rejects as a syntax error and SQLite silently accepts. So the builder is
portable and no caller needs a length guard for *correctness*.

**But hand-writing the predicate is not.** A raw `IN (${ids.join(',')})` breaks on an empty
array in Postgres only — the exact shape of bug that passes every local test and fails once,
in production, on the first request that happens to filter nothing. Always go through
`inArray`.

A length guard is still worth adding where it saves a round trip (`if (ids.length === 0)
return []`), but that is a performance decision, not a portability one.

### Rule 10 — `count(*)` comes back as a string from postgres-js

Postgres `count(*)` is `bigint`, which exceeds JavaScript's safe integer range, so postgres-js
returns it as a **string** to avoid silent precision loss. better-sqlite3 returns a number.

Every count therefore passes through `Number(...)`, or casts in SQL (`count(*)::int`).
`server/db/queries/count-rows.ts` already does the first. A count used directly in
arithmetic would concatenate instead of adding on one engine and not the other — `"5" + 1`
is `"51"`.

### Rule 11 — text ordering differs, so every `ORDER BY` needs a deterministic tiebreaker

SQLite compares text with `BINARY` collation. Postgres uses the database's collation, which
on Supabase is locale-aware: case and punctuation sort differently, and `ORDER BY name` can
genuinely return a different order on the two engines.

This is not a correctness bug for any single row, but it makes pagination unstable and makes
two runs of the same job write rows in a different order. **Every `orderBy` in this codebase
ends with a unique column** — usually `id` — so the total order is deterministic regardless
of collation. Keep it that way when adding one.

### Rule 12 — the demo seed never runs against Postgres, and `LIKE` is why it can afford to

`server/db/seed/demo/index.ts` uses `like(users.email, '%@demo.ustaad.test')` to find its own
rows. That is case-insensitive on SQLite and case-sensitive on Postgres, which would make the
seed silently fail to clean up.

It is not fixed, because it does not need to be: the seed **refuses to run when
`SUPABASE_DB_URL` is set** (it writes invented people with a published password). If that
refusal is ever relaxed, this `LIKE` becomes a real bug — fix it then, or better, do not
relax the refusal.

Application code has no other `LIKE`. Email lookups normalise to lower case in
`server/repositories/users.ts` and compare with `eq`, which behaves identically on both.

### Rule 13 — no `.returning()`, and Postgres supporting it changes nothing

Postgres supports `RETURNING` well; SQLite's has documented interactions with triggers and no
row-order guarantee for multi-row statements. The temptation on migration day is to start
using it now that production is Postgres.

Don't. Development still runs SQLite, so a `.returning()` added in production-shaped code is
a query the local suite exercises on the *other* engine. Ids are generated before the insert
(`newId()`), so nothing is gained.
