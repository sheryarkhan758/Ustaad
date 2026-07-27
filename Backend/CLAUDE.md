# CLAUDE.md — Ustaad.com

Read this file completely before writing any code. It encodes the project's invariants.
These are not preferences. Violating one is a defect even if the feature works.

If a task appears to require breaking an invariant, **stop and say so.** Do not
work around it, do not implement a "temporary" version, do not leave a TODO.

---

## 1. What this project is

Ustaad.com is a verified tutor discovery and home-tuition matching platform for Pakistan.
Individual final-year project. Full-stack web application delivered as an installable PWA.

- **Specification:** `docs/spec.docx` (v4.0, 26 July 2026). A plain-text extraction is at
  `docs/spec.txt` — grep that, it is faster and searchable.
- **Scale:** 287 functional requirements across 33 modules (§6.1–§6.33). The spec's own
  front matter and §18 still say "219 across 32" — that figure is stale from v3.0 and was
  not updated when §6.32 and §6.33 were added. Trust the section bodies, not the headline.
- **Data model:** `docs/DATA_MODEL.md` — 47 tables, one line each: what it holds and **who may
  read it**. Check the visibility column before writing any query that joins or returns a table
  you have not worked with. Several rows there are safety controls, not privacy preferences.
- **Progress tracker:** `docs/PROGRESS.md`. Update it at the end of every task.
- **Infrastructure budget:** zero. Every service must sit inside a permanent free tier.

### Roles (§5.1)

`ADMIN` · `TUTOR` · `PARENT` · `STUDENT` (18+, self-managing) · `ORGANIZATION`.

A minor is **not** a role. See invariant 3.

---

## 2. The invariants

### 2.1 Database: one portable schema, two dialects

Development runs against a local SQLite file. Production runs against Supabase Postgres,
selected by the presence of one environment variable, `SUPABASE_DB_URL`.

**The full rules, and where each is enforced, are in `server/db/PORTABILITY.md`. Read it
before touching the schema.** `server/db/portability.test.ts` checks every one of them
mechanically; `npm test` runs it. The summary:

- **All database access goes through Drizzle ORM**, and **route handlers call repositories,
  never `db`.** `server/repositories/` is the only layer that builds queries.
- **No hand-written SQL in route handlers.** The one raw fragment in the codebase lives in
  `server/db/queries/count-rows.ts`, behind a named function, with a comment stating why.
  eslint fails the build on a `sql` tagged template anywhere else.
- **Every column is `text`, `integer` or `real`** — the three builders whose signatures and
  semantics are identical in `sqlite-core` and `pg-core`. Never a `mode:` variant. That is what
  lets `server/db/schema-pg/` be *generated* from `server/db/schema/` (`npm run schema:pg`)
  rather than hand-maintained.
- **Timestamps are ISO-8601 UTC text**, fixed width, stamped by `nowIso()` / `toDbTimestamp()`.
  Never `datetime()`, `strftime()`, `julianday()`, `date('now')`, `CURRENT_TIMESTAMP`, or a
  database-side default.
- **Booleans are integer 0/1** through `toDbBool` / `fromDbBool`. Never truthy text, never
  `mode: 'boolean'`.
- **JSON is text** through `toDbJson` / `fromDbJson`. Never `jsonb`, never `JSON_EXTRACT`,
  never `->>`; no query reaches inside the column.
- **No `.returning()`, anywhere.** Ids are known before the insert, so write then select.
- **Primary keys are text.** Reference tables use stable hand-authored slugs (`sindh`,
  `karachi-clifton`, `math-matric-sindh-quadratic-equations`); entity tables use `newId()`.
  No `AUTOINCREMENT`, no `rowid`, no sequence.
- **No `.all()`, `.get()` or `.run()`** — better-sqlite3 only; always `await` the builder. And
  no `db.transaction()` outside `server/db/index.ts`, because its callback is synchronous on
  one driver and asynchronous on the other.
- **Money is integer paisa** (1 PKR = 100 paisa), everywhere, with no exceptions. Never a
  float, never a decimal string. Convert at the interface boundary via `shared/rates.ts`.
- **Relative imports are extensionless** (`from './reference'`). drizzle-kit bundles the schema
  to CJS through esbuild and will not resolve a `.js` specifier back to a `.ts` file.
- **Exactly one file knows which engine is running** — `server/db/index.ts`. `PRAGMA` appears
  only there. (`test-db.ts` and `migrate.ts` are the two acknowledged exceptions.)
- Every query must survive the Postgres migration unchanged. If you are unsure whether
  something ports, assume it does not.

### 2.2 Nothing sensitive enters the repository or the logs

This is a **public GitHub repository.**

- Never commit user data, credentials, or a `.db` file. `.gitignore` already excludes
  `.env`, `.env.*` (except `.env.example`), `*.db`, `*.db-journal`, `local.db`,
  `/node_modules`, `/dist`. Do not weaken it. If you introduce a new secret-bearing or
  data-bearing path, add it to `.gitignore` in the same change.
- `.env.example` lists variable names with placeholder values only. **Never a real value.**
- **Never log** a CNIC number, a password, a token or session cookie, or a full residential
  address — at any log level, in any environment, including error paths and stack traces.
  When you must log an entity, log its id.
- CNIC numbers are never stored in a searchable column. A salted hash supports duplicate
  detection only; the image lives in the private Supabase bucket. (SEC-8, NFR-10)
- Residential addresses are captured on a booking, encrypted with AES-256-GCM, and readable
  only by the two parties. A public profile exposes area, never a street address.
  (SEC-3, FR-2.8, NFR-18)
  - **`server/services/address.ts` is the only module that may decrypt one.** The ciphertext
    is reachable only through `findBookingAddressCiphertext`; `BookingRecord` has no address
    field at all, so a handler cannot leak what it never receives.
  - The tutor sees the **area** before she confirms and the **street** only after (SEC-20).
    She is deciding whether to travel alone to a house she has not seen; withholding the area
    would make that decision impossible, and disclosing the street early would hand a family's
    address to someone who then declines.
  - An administrator is not a third party: `discloseAddressToAdministrator` demands a written
    reason and writes to the append-only log **before** decrypting.
- Verification documents are served exclusively by short-lived signed URLs scoped to
  administrators, and every access is logged. (SEC-7, NFR-9)

### 2.3 Minors hold no account

- A student under 18 exists **only** as a `student_profiles` record owned by a `PARENT`
  account. There is no `users` row for a minor.
- There is no login path, no registration path, no invitation path, no password reset path,
  and no token issuance path that produces credentials for a minor. If you find yourself
  writing one, you have misread the task.
- `REGISTERABLE_ROLES` in `shared/auth.ts` is the complete set a registration may request.
  `admin` is absent by construction (FR-1.5), and no role for a minor exists. Registering as
  `student` means an **adult** student and requires a date of birth, checked in the schema and
  again in the service against an injected clock.
- `server/child-safety.test.ts` asserts all of this structurally: that `student_profiles`
  carries no credential column, that no table holds both a credential and a student-profile
  reference, and that every plausible API attempt to obtain credentials for a minor is refused.
- There is no private channel between a tutor and a minor anywhere in the system — not in
  messaging, not in booking, not in group tuition, not in session notes. All coordination
  routes through the parent's contact. (SEC-1, SEC-2, OBJ-11, decision 2)
- This is a structural property of the data model, not a policy check. Keep it structural:
  the absence of the table row is the enforcement.

### 2.4 Gender preference is a hard filter

- Gender preference (`female_only` | `male_only` | `no_preference`) is a **hard exclusion
  enforced in application code.** A non-conforming tutor is **absent from the result set** —
  not ranked lower, not greyed out, not flagged in the UI.
- It is never a ranking weight, never a scoring term, never only a client-side filter.
- When an AI agent shortlists tutors, the constraint is applied **in code to the tool
  result**, after the model has spoken. The model is never trusted to respect it.
  (FR-16.3, FR-16.4)
- The default is `no_preference`. The system never pre-sets the filter on a user's behalf.
  (FR-16.6)
- It is applied in the **SQL predicate** in `server/repositories/search.ts`, before ranking.
  `shared/ranking.ts` has no gender term and must never acquire one. The test that guards
  this asserts **absence**, not ordering — a test checking "female tutors come first" would
  pass on an implementation that showed male tutors last, which is the one thing forbidden.
- Tutors hold the reciprocal right: a tutor's own student-gender restriction, guardian-
  presence requirement and area restriction are enforced by the system, not merely
  displayed. Declines made under a declared safety constraint are excluded from her
  confirmation-rate statistic. (SEC-19, SEC-21, FR-29.10, FR-29.14)

### 2.5 Verification is platform-owned

- Only an `ADMIN` can approve a tutor, and only against a CNIC and academic documents.
  A tutor cannot self-certify. No third party is relied upon.
- Every verification record is **timestamped and attributed to the approving administrator**,
  and written to the append-only audit log. (FR-6.6)
- The record states **which artefacts were checked** — CNIC, academic document, or both —
  and that list is published on the profile. (FR-6.5, FR-6.9)
- A tutor profile is not searchable until identity verification is approved. (FR-6.3)
- **Badge wording states exactly what was checked and never implies a police or background
  check, because none is performed.**
  - Permitted: `CNIC verified by Ustaad.com` · `Academic documents reviewed` ·
    `Passed assessment: Organic Chemistry`.
  - **Prohibited anywhere in the product, including marketing copy, i18n strings, alt text
    and README:** `Trusted` · `Safe` · `Vetted` · `Background checked` · `Police verified` ·
    `Screened` · `Certified safe`. (FR-6.8, SEC-6, §4.2)
- Identity verification (administrator, manual) and competency verification (AI, per topic)
  are two independent tracks, displayed separately, never merged into one badge. (FR-6.2)
- A volunteer tutor is verified on exactly the same basis as a paid tutor. The volunteer
  flag never substitutes for verification. (FR-33.10)

### 2.6 The platform records payments; it never processes them

- **No payment gateway. No escrow. No fund custody. No payout logic. No commission
  handling. No wallet. No refund flow. Ever.**
- What exists is a record: agreed rate and rate type frozen at confirmation, payment status
  (`pending` | `family_marked` | `settled` | `disputed`), dual acknowledgement, and an
  administrator dispute path. (§6.31)
- A payment is `settled` only when **both** parties have acknowledged it. A single-party
  claim displays as unconfirmed. (FR-31.4)
- Payment history contributes to **neither** public ranking **nor** public statistics.
  (FR-31.12, SEC-22)
- The interface states plainly, at every point where payment appears, that Ustaad.com does
  not process or hold funds. (FR-31.10, SEC-23)
- **If a task seems to require payment processing, stop and flag it.** Do not stub a
  gateway, do not add a Stripe key to `.env.example`, do not model a balance.

### 2.7 The audit log is append-only

- `admin_actions` is written by `INSERT` only. **No application path issues an `UPDATE` or
  a `DELETE` against it** — not for corrections, not for cleanup, not in a migration, not in
  a test helper, not in an admin tool. A mistake is corrected by appending a corrective
  entry. (NFR-19, SEC-13)
- Every administrator decision that affects a person — verification approval or rejection,
  appeal override, dispute resolution, flag resolution, feedback triage — writes an entry
  carrying actor, action, target, timestamp and reasoning.
- This is what makes the verification chain of custody in §6.6 meaningful rather than
  decorative.

### 2.8 Derived statistics are materialised, never computed in a request

- `tutor_scores`, `tutor_search_signals`, `tutor_reliability` and `rate_benchmarks` are
  written **only** by the jobs in `server/jobs/` (`npm run jobs`). Search and profile
  requests read them. (§9.4, NFR-15, decision 9)
- The boundary: **computing a statistic** — a median, a rate, a count over reviews — belongs
  in a job. **Looking one up** and combining already-materialised values with a fixed
  weighted sum is what a request may do, and is what `shared/ranking.ts` does.
- **A search request performs no aggregate computation and makes no AI call.** It is
  indexed SQL against materialised columns.
- **Budget: search returns in under 500 ms against a 500-tutor dataset.** (NFR-1)
  `npm run bench:search` seeds 500 synthetic tutors, runs the jobs, and prints the p95 for
  four scenarios. Current worst p95: **30.44 ms**. If a change adds a join, a subquery or a
  per-row computation to the search path, run it again.
- Aggregate views suppress small cohorts: rate benchmarks below a cohort of 4, unmet demand
  below a cohort of 3. Enforce the threshold in code, not in the UI. (SEC-16, SEC-17, NFR-16)
- **A suppressed aggregate must not be differenceable.** `DEMAND_WINDOW_DAYS` in
  `shared/unmet-demand.ts` is a constant and must stay one: a board you can query at 29 days
  and again at 30 hands the caller the records in between, and a threshold of three protects
  nothing against someone who can subtract. No aggregate response carries a timestamp, an
  ordering by recency, or a caller-chosen window, and every field a caller may filter on is
  already part of the cohort key — so a filter selects whole cohorts and can never slice one.

### 2.9 AI is never in the path of a hard constraint

> The model classifies, narrates and sequences. The application code computes, validates
> and enforces. (§7.2)

- The model **never** emits a score, a price, a ranking, a rate, a date, a session count, or
  a constraint decision. Every number a user sees comes from a deterministic function over
  stored structured signals.
- Agents **propose**; application code **enforces**. Hard constraints — gender, budget, area,
  board, level, engagement type, availability — are filtered in code **after** the tool call.
- Ranking is deterministic and reproducible. AI narrates a breakdown it is given and is
  forbidden from introducing any figure not present in that breakdown. (FR-7.5, FR-22.4)
- Group matching is constraint satisfaction, not model judgment. (FR-23.7)
- Study-plan prerequisite ordering is validated in code after generation; the plan is
  regenerated on violation. (FR-26.2)
- Every AI-dependent path has a working non-AI fallback. (NFR-11)
- User text (reviews, biographies, profiles, feedback) is **data, not instructions**. Prompts
  must instruct the model to disregard instructions embedded in user content. (SEC-11)
- AI credentials are server-side only. No key is reachable from the browser bundle. (NFR-5,
  SEC-12)
- Prompts live as versioned Markdown in `/prompts` and are loaded at runtime, never inlined
  in source (`server/ai/prompts.ts`). Every AI output row persists the model id and prompt
  version. (§7.3)
- **Every model call goes through `server/ai/call.ts#callModel`.** Nothing else touches a
  provider, and `server/ai/provider.ts` is the only file that reads a provider key. That
  single chokepoint is what makes the budget guard and the usage log complete rather than
  best-effort: replay → demo guard → budget → failover → Zod parse (one retry) →
  `ai_call_log`. A new AI feature that calls a provider directly is a defect.
- **The decision contract has no field for a figure.** `shared/ai-contract.ts` exposes no
  `score`, `price`, `rank`, `rate`, `amount` or date on any agent response, and the search
  tool call carries curriculum fields only — no gender, no budget, no area. A model cannot
  relax a constraint it has no way to express; adding such a field is the defect, not the
  handler that would read it.
- **Every AI path degrades, never errors.** An exhausted budget, an unparseable response,
  or every provider being down hands the user the manual path with an explanation
  (NFR-11). Someone who has just described their child's difficulty must never get a
  stack trace.
- **`DEMO_REPLAY=true` makes a live call impossible**, not merely unlikely: `callModel`
  fails closed when no stored response covers the call (§6.15, §7.4).
- A claim reaches `claim_status = 'verified'` only through `applyVerdict` in
  `server/ai/agents/competency-verification.ts`, which refuses to run without the
  `verification_attempts` row that justifies it. There is no second writer.
- Every AI path has a **working non-AI fallback** (NFR-11). `server/ai/provider.ts` chains
  Gemini → Groq → a heuristic classifier; the last link needs no key and no network, which
  is also what makes the test suite deterministic and free.
- A malformed model response is retried **once**, then the record is marked `unanalysed` and
  the work moves on. A bad response must never lose the user's data.

### 2.10 User text is stored unchanged and never machine-translated

- All user-generated text may be Urdu script, Roman Urdu, English, or a mix of all three
  within one sentence. **Store it byte-for-byte unchanged.**
- **Never machine-translate user-generated content** — not reviews, not biographies, not
  feedback, not session notes, not volunteer motivations. Translating a reviewer's words
  would misrepresent them. (Decision 13, FR-32.3)
- The **interface** is bilingual through `i18n_strings` and i18next. That is a dictionary of
  authored strings, not translation of user content. The two are never confused.
- Never normalise, transliterate, strip diacritics, or "clean up" user text. Never validate
  it against a Latin-only character class. Columns holding user text must accept the full
  Unicode range in both dialects.
- Urdu renders right-to-left. Use CSS logical properties; RTL must not break alignment.
  (NFR-17, §6.27)

---

## 3. Repository layout

```
/client        React 18 + Vite PWA — empty for now
/server
  index.ts     Express bootstrap
  /db
    index.ts   the ONLY driver-aware file; exports `db` (SUPABASE_DB_URL switches)
    PORTABILITY.md   the SQLite → Postgres rules. Read before touching the schema
    migrate.ts migration runner, branches on dialect
    test-db.ts in-memory database + fixtures for tests
    portability.test.ts   enforces PORTABILITY.md mechanically
    /schema    _common.ts · reference · identity · tutor · booking · payment
               feedback · ai · matching · admin · derived · platform · index (barrel)
    /schema-pg GENERATED from /schema — never hand-edited (npm run schema:pg)
    /queries   the only place a raw SQL fragment may live
    /migrations     drizzle-kit, SQLite    — never hand-edited
    /migrations-pg  drizzle-kit, Postgres  — never hand-edited
    /seed      reference.ts (data) · validate.ts (checks) · index.ts (runner)
  /repositories  THE query layer, one module per aggregate. Route handlers call
               these and never import `db`. tutors · bookings · reviews ·
               payments · feedback · volunteers
  /routes      Express route handlers — thin; no SQL, no db, no business rules
  /ai          provider adapter (Gemini → Groq → heuristic) and prompt loader
  /jobs        THE only writers of the materialised tables (npm run jobs)
               tutor-scores · tutor-reliability · rate-benchmarks
  /ai          call.ts (the ONLY caller of a provider) · provider.ts (the only reader of
               a provider key) · budget.ts (daily guard + usage log) · prompts.ts
               narration.ts · study-plan.ts
               /agents  diagnostic-intake.ts · competency-verification.ts
  /services    rules the schema cannot express, plus deterministic computation
               bookings.ts (state machine) · payments.ts (immutability) · audit.ts (append-only)
               verification*.ts · address.ts · storage.ts · tutor-onboarding.ts
               group-matching.ts · unmet-demand.ts · feedback.ts · volunteers.ts
               mail.ts (the ONLY sender; never writes, never throws)
               submitted-files.ts (bytes the server holds, sniffed before storing)
  /middleware  auth, role guards, rate limiting, validation
/shared        Zod schemas and pure logic shared with the client
               db-values.ts (boolean/JSON/timestamp helpers) · rates.ts
               booking-status.ts · payment-status.ts · student-profile.ts
               storage-path.ts · ranking.ts (the deterministic score)
               competency.ts (the FR-11.5 rubric) · badges.ts
               ai-contract.ts (the JSON decision contract — decision 7)
               group-matching.ts (the pure solver) · unmet-demand.ts (banding + suppression)
               file-signature.ts (magic bytes) · anti-abuse.ts (honeypot + time on form)
               feedback.ts · volunteers.ts
/prompts       versioned AI prompt Markdown
/docs          spec.docx · spec.txt (greppable) · PROGRESS.md
/scripts       print-prereq-chain.ts and other verification scripts
```

**Runtime note.** better-sqlite3 must be v12 or later here — earlier versions have no
prebuilt binary for Node 24 on Windows and this machine has no Visual Studio to compile
one. If `npm install` dies in node-gyp, that is the cause.

Reference data (locations, adjacency, subjects, topics, prerequisites, boards, levels,
exam windows, service types, i18n strings) **is** committed as seed files — it is static and
contains no user information. Everything else is not. (§12)

## 4. Stack

React 18 + Vite · Tailwind · React Router v6 · TanStack Query · i18next · Recharts ·
Node + Express · **Zod** (schemas in `/shared`, used on both sides) · bcrypt + JWT in an
httpOnly cookie · **Drizzle ORM** · better-sqlite3 (dev) / postgres.js (prod) ·
Supabase Storage (private bucket) · EmailJS · Gemini Flash (primary) / Groq Llama 3.3
(fallback) · Netlify or Vercel.

> Note: §10.2 of the spec shows an illustrative snippet using `@libsql/client` and
> `TURSO_URL`. That contradicts §10.1 and §10.3, which select Drizzle over
> better-sqlite3/postgres.js with Supabase in production. **Follow §10.1. Drizzle only.**
> Turso is documented in §10.3 as a fallback if the Postgres migration proves disruptive;
> it is not the current plan.

## 5. Working rules for every session

1. **Read `docs/PROGRESS.md` first.** Update it last. Every task ends with the checklist
   reflecting reality — checked only when the module works completely.
2. **Validate every endpoint input with a Zod schema from `/shared`.** Client-side guards
   are for user experience only and are never relied upon. (NFR-6, NFR-7)
3. **Every mutating endpoint checks role *and* resource ownership server-side.** (NFR-6)
4. Route handlers stay thin: parse → authorise → call a service → respond. Business rules
   live in `server/services/`, database access in `server/db/`.
5. Migrations are generated by `npm run db:generate` and never hand-edited. Schema changes
   go in `server/db/schema/`.
6. A feature ships only if it works completely, appears in the demonstration path, and can
   be described in one line in the README. Half-working is worse than deliberately deferred
   — move it to §4.3 "planned but not built" instead. (§18)
7. Out of scope, permanently: payment processing, payouts, in-app chat, video calling, GPS
   or lat/long, push notifications, native Android build, ML recommendation engines,
   gamification, background checks. Area is the finest location granularity in this project.
   (§4.2)
8. When something in a task conflicts with this file, **the invariant wins** — say so and
   stop rather than quietly complying.

### 2.11 Sessions

- Short-lived JWT **access** token (15 min) in an httpOnly, `sameSite=lax`, `secure`-in-production
  cookie, plus a rotating opaque **refresh** token (7 days) scoped to `/api/auth`.
- **No token in `localStorage`, no token in a URL, no token in a log line, ever.** The cookie is
  the only accepted carrier — there is deliberately no `Authorization` header path.
- Refresh tokens are stored as a SHA-256 hash, never in the clear, and grouped into a family per
  login. Presenting an already-rotated token revokes the whole family and bumps `tokenVersion`:
  the server cannot distinguish a confused client from a stolen token, so it assumes the worse.
- The access token is verified without a database read, which is what keeps NFR-1 reachable.
  The cost is that revocation takes effect within one access-token lifetime — bounded at 15
  minutes, and stated rather than hidden.

### 2.12 Group matching is constraint satisfaction, and it explains itself

- Pooling is a **pure deterministic function** — `poolRequests` in
  `shared/group-matching.ts`. No database, no clock, no randomness, no AI (FR-23.7,
  decision 10). The same input yields the same grouping, byte for byte, whatever order the
  candidates arrive in. A family has to be told *why* it was grouped with these particular
  students, and a solver can answer that where a model cannot.
- Every hard constraint must agree between **every pair** of members, not merely between
  each member and the seed: curriculum triple, topic overlap, area or adjacency **with both
  families flexed**, a shared weekly window, and gender.
- A group's gender requirement is the **strictest** any member stated, carried on the
  proposal and enforced against the tutor in code — the same hard exclusion §2.4 gives
  search. It never relaxes a stated preference and never sets one; a family pooled into a
  stricter group is told so in its explanation, before it confirms.
- Grouping is **opt-in only**. Nothing outside `createGroupRequest` writes a
  `group_requests` row.
- **`group_proposals.confirmed_at` is the commit point.** Member bookings are written first
  and are not a group until that one column is set, because a cross-dialect
  `db.transaction()` is impossible here (§2.1) and a helper that pretended otherwise would
  be worse than none. Nothing may treat a set of bookings as a group except by resolving
  them through a confirmed proposal.
- A candidate group is **re-derived from the solver** before it is proposed, never trusted
  from a request body — otherwise a caller could assemble a group the constraints forbid
  simply by not asking.

### 2.13 A notification channel is never a system of record

- **The row is written before the mail, and the dispatch outcome is written against the
  row** (FR-33.9, FR-32.9). EmailJS has a monthly quota, a template that can be renamed,
  and a request that can be blocked; if the email were the only artefact, any of those
  would discard a volunteer application while the applicant's browser showed success.
- `server/services/mail.ts#dispatch` **never throws and never writes.** It takes an id that
  already exists and returns an outcome. An exception would skip the caller's next line —
  turning a recorded failure, which a retry sweep can find, into an unrecorded one.
- A dispatch reports the **worst** outcome across its messages. The team being notified
  while the applicant's acknowledgement failed is not a success: the applicant is the
  person waiting.
- Not configured is `skipped`, not `sent`. A row must never claim a send that never
  happened.
- EmailJS credentials are **server-side and unprefixed** — no `VITE_` identifier that can
  send mail reaches the browser bundle. There is no SMTP credential, mail password or
  private key in this repository, and `EMAILJS_PRIVATE_KEY` is EmailJS's own optional
  strict-mode token, not a mail password (SEC-25).

### 2.14 A file is what its bytes say it is

- Where the server holds the bytes, an upload is accepted only when its **declared type,
  its extension and its leading bytes all agree** (`shared/file-signature.ts`, SEC-24).
  `payload.exe` renamed to `cv.pdf` and posted as `application/pdf` passes both declaration
  checks and is still an executable in the private bucket.
- Both publicly reachable forms take their attachment as bytes in the body rather than
  through a signed upload ticket, precisely so the content can be checked. Issuing a
  bucket-write credential to an anonymous caller would be the alternative.
- The ticket path (tutor documents) still cannot be sniffed — the browser PUTs straight to
  Supabase. That gap is recorded in `docs/PROGRESS.md`; do not describe it as closed.
- A rejection names the declared type and never the detected one. A public form that told
  you what it found is a free file-type oracle.

## 6. Commands

```
npm run dev          # Express API with tsx watch
npm run db:generate  # drizzle-kit: generate migrations from schema
npm run db:migrate   # apply migrations to the configured database
npm run db:seed      # seed reference data (validates first, aborts on bad data)
npm run db:studio    # drizzle-kit studio
npm run db:verify    # row counts, every table (--json for the migration diff)
npm run jobs         # recompute every materialised table
npm run bench:search # seed 500 tutors, run the jobs, print search p95 (NFR-1)
npm run schema:pg    # regenerate the Postgres schema mirror from /schema
npm run schema:pg:check   # fail if the mirror is stale
npm test             # vitest (includes the portability suite)
npm run lint         # eslint
npx tsc --noEmit     # typecheck

npx tsx scripts/print-prereq-chain.ts                      # §2.4 worked example
npx tsx scripts/print-prereq-chain.ts <topic-id>           # any topic
npx tsx scripts/print-prereq-chain.ts --list quadratic     # find a topic id
```

To rebuild the database from nothing:
`rm -f local.db* && npm run db:migrate && npm run db:seed`

Deployment day: `scripts/migrate-to-supabase.md` is the runbook, with the rollback step.
