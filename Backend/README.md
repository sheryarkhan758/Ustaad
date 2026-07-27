# Ustaad.com

**Verified tutor discovery and home-tuition matching for Pakistan.**

A family describes a problem in their own words — *"my daughter is weak in Maths"* — and the
platform locates the actual gap, which is usually three topics upstream of the one they named,
then shows them tutors the platform has itself verified. A tutor sets the conditions under
which she will travel to a stranger's house, and the system enforces them rather than
displaying them.

Final-year project. Full-stack web application delivered as an installable PWA.
**Infrastructure budget: zero.** Every service sits inside a permanent free tier.

---

## Quick start

```bash
git clone <this-repo> && cd ustaad
npm install
npm run setup            # .env with generated secrets, migrate, seed reference + demo data
npm run dev              # API on http://localhost:3000
```

Then, without logging in:

```bash
curl http://localhost:3000/api/demo/scenarios
curl "http://localhost:3000/api/search?genderPreference=female_only&mode=home&areaId=karachi-clifton&subjectId=mathematics&levelId=matric&boardId=sindh-board"
```

The first returns five one-click demonstration scenarios. The second returns seven verified
female tutors who teach at home in Clifton — the platform's primary use case, and the one that
must never come back empty.

`npm run setup` is the four steps below run in order. If you would rather do them by hand:

| Step | Command | What it does |
|---|---|---|
| 1 | `npm run setup:env` | Writes `.env` from `.env.example` with freshly generated `JWT_SECRET`, `CNIC_HASH_SALT` and `ADDRESS_ENCRYPTION_KEY`. Never overwrites an existing `.env`. |
| 2 | `npm run db:migrate` | Applies the migrations to `local.db`. |
| 3 | `npm run db:seed` | Reference data: provinces, cities, 72 areas, subjects, levels, boards, 202 topics, the prerequisite graph, i18n strings. |
| 4 | `npm run db:seed:demo` | 35 tutors, families, bookings, reviews, payments, five recorded agent sessions — then runs the materialisation jobs. |

**No AI key is required.** Every AI path has a working non-AI fallback (NFR-11), and the
demonstration path makes no model call at all (FR-15.7). Add `GEMINI_API_KEY` or `GROQ_API_KEY`
to `.env` only if you want the live agents.

To rebuild from nothing: `rm -f local.db* && npm run db:reset`.

---

## Guest credentials

Every demonstration account uses the same password:

```
demo-ustaad-2026
```

| Role | Email | What to look at |
|---|---|---|
| **Parent** | `parent@demo.ustaad.test` | Two children (both minors, neither with an account), a completed monthly engagement with session notes, a live booking, and a progress ledger showing one topic improving and one stagnant. |
| **Tutor** | `ayesha-siddiqui@demo.ustaad.test` | Approved, CNIC and degree verified, a verified competency badge, three pricing shapes, safety constraints set, and a five-star review that quotes her work. |
| **Tutor (rejected, appealing)** | `kamran-baig@demo.ustaad.test` | A rejection with a written reason and an open appeal — SEC-18 in the data. |
| **Student (adult)** | `student@demo.ustaad.test` | The only learner with an account, because she is over eighteen. |
| **Organisation** | `academy@demo.ustaad.test` | An approved academy with an open vacancy and one tutor who expressed interest. |
| **Administrator** | `admin@demo.ustaad.test` | The dashboard: pending verifications, an open flag, a safety-flagged review, an open appeal, a dispute under review, expiring badges. |

These are synthetic accounts in a local SQLite file that never enters the repository. The
password is published here because it protects nothing (FR-15.9) — on a file on your own
machine. Against a Postgres database `npm run db:seed:demo` **refuses this password**: a
live run requires `DEMO_SEED_PASSWORD`, at least 12 characters and not the one above, so
the credential printed here never reaches anything internet-facing. See `DEPLOY.md` §2.

---

## The demonstration path

Five scenarios, none requiring login, none making a live API call (§6.15).

| Key | Shows | Requirement |
|---|---|---|
| `diagnostic-root-gap` | "Weak in Maths" resolves in three questions to a signed-number-arithmetic gap three topics upstream. The shortlist is filtered **in code** after the model speaks. | FR-15.2 |
| `review-analysis` | A five-star review describing repeated lateness, flagged as contradictory. A review reading only "Best teacher ever", down-weighted to 0.35 — and still visible. | FR-15.3 |
| `competency-chemistry` | A tutor passes Organic Chemistry and fails Thermodynamics. The badge is withheld **for the failed topic only**. | FR-15.4 |
| `ranking-explanation` | A narrated score beside the raw signal table it was generated from. | FR-15.5 |
| `female-home-karachi` | A female-only home search in Clifton. Male tutors are **absent from the result set**, not ranked last. | FR-15.6 |

```bash
curl http://localhost:3000/api/demo/scenarios/diagnostic-root-gap/turns/0
```

Why this matters: §15's risk table names a free-tier rate limit reached during assessment as a
live risk. Rather than hope, the demonstration routes **import nothing from `server/ai/`**.
There is no code path from them to a network socket, so they work with every AI key deleted
from `.env` — which is how they are tested.

---

## Documentation

| Document | What it holds |
|---|---|
| [`docs/API.md`](docs/API.md) | All 108 endpoints: method, auth, request shape, response, error codes. **Generated** from the Zod schemas — `npm run docs:api -- --check` fails if it drifts from the mounted application. |
| [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) | §11 controls SEC-1 to SEC-26, each mapped to enforcing code or listed as an honest gap. |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | 48 tables, one line each: what it holds and **who may read it**. |
| [`docs/PROGRESS.md`](docs/PROGRESS.md) | Module-by-module build state. A module stays unticked until it works completely. |
| [`CLAUDE.md`](CLAUDE.md) | The project's invariants. Violating one is a defect even if the feature works. |
| [`server/db/PORTABILITY.md`](server/db/PORTABILITY.md) | The SQLite → Postgres rules, mechanically enforced by `portability.test.ts`. |

---

## Security, privacy and safety

§11 is a required chapter of this README, not an appendix to it. **The platform matches adults
to children in private homes and records financial agreements; the safety design is a primary
deliverable.** The full control-by-control pass is in
[`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md) — 17 enforced, 2 enforced structurally,
4 partial, with every shortfall named rather than counted as done.

The load-bearing ones:

**Minors hold no account.** A student under 18 exists only as a `student_profiles` record owned
by a parent. There is no `users` row, no login path, no invitation path, no password-reset path
and no token-issuance path that could produce credentials for a child. This is a structural
property of the data model, not a policy check — the absence of the table row is the
enforcement, and `server/child-safety.test.ts` asserts it 19 different ways.

**No private tutor-to-student channel exists anywhere.** Not in messaging, not in booking, not
in group tuition, not in session notes. All coordination routes through the parent's contact.
In-app chat is permanently out of scope, which is also why there is no `message` target in the
reporting vocabulary: a target type for a table that cannot exist is an invitation to build it.

**Gender preference is a hard filter.** A non-conforming tutor is *absent from the result set* —
not ranked lower, not greyed out, not flagged. It is applied in the SQL predicate before
ranking, and `shared/ranking.ts` has no gender term. When an AI agent shortlists tutors the
constraint is applied **in code to the tool result**, after the model has spoken; the search
tool call has no gender field at all, so a model cannot relax a constraint it cannot express.

**The tutor is protected too.** Her student-gender restriction, guardian-presence requirement
and area restrictions are enforced by the system rather than displayed. She sees the **area**
before she confirms a booking and the **street only after** — she is deciding whether to travel
alone to a house she has not seen, and disclosing the street early would hand a family's
address to someone who then declines. Declines made under a declared safety constraint are
excluded from her public confirmation-rate statistic, so holding to her own conditions costs
her nothing.

**Verification is platform-owned and specific.** Only an administrator can approve a tutor, only
against a CNIC and academic documents, and the record states **which artefacts were checked**.
Badge wording says exactly that and never more: `CNIC verified by Ustaad.com`,
`Academic documents reviewed`, `Passed assessment: Organic Chemistry`. The words *Trusted*,
*Safe*, *Vetted*, *Background checked*, *Police verified*, *Screened* and *Certified safe* are
**prohibited everywhere in the product**, because no background check is performed and implying
one would be a lie a parent might act on. `shared/badges.test.ts` is adversarial over more than
a thousand input combinations.

**CNIC numbers are never stored.** A salted SHA-256 hash supports duplicate detection and
nothing else. The image lives in a private bucket, served only by short-lived signed URLs scoped
to administrators, with every access logged before the URL is issued.

**Addresses are encrypted and compartmentalised.** AES-256-GCM, captured on a confirmed booking,
readable only by the two parties. One module may decrypt; `BookingRecord` has no address field
at all, so a handler cannot leak what it never receives.

**The audit log is append-only.** No application path issues an `UPDATE` or a `DELETE` against
`admin_actions` — the database handle itself throws. A mistake is corrected by appending a
corrective entry. That is what makes the verification chain of custody a claim about the past
rather than a claim about the present.

**Nothing sensitive is logged.** Never a CNIC, a password, a token or a full address, at any
level, in any environment, including error paths.

---

## Deliberate architectural decisions

Three choices that a reader might otherwise mistake for gaps.

### A single PWA, not a native Android build

The brief calls for web and Android delivery. Building two native codebases inside this
timeline, alongside a five-component AI layer, would have compromised both. The resolution is
one installable Progressive Web App with a manifest, icon set, service worker and offline
shell. On Android it installs to the home screen, launches full-screen with a splash screen,
and is indistinguishable from a native application in normal use. One codebase, one deployment,
both platforms served.

This is a deliberate architectural decision with its rationale, not a substitution hoped to pass
unnoticed.

### Payment transparency without payment processing

**There is no payment gateway, no escrow, no fund custody, no payout logic, no commission
handling, no wallet and no refund flow.** There never will be. `payments.flow.test.ts` greps the
entire codebase for nine gateway names and the payment schema for balance, wallet, payout,
refund, escrow and commission columns, and fails if any appears.

What exists is a *record*: the agreed rate frozen at confirmation, a payment status, dual
acknowledgement, and an administrator dispute path. A payment is `settled` only when **both**
parties have said so; one party's claim displays as unconfirmed.

This is not a shortcut around the hard part. The market's actual payment failure is
disagreement about what was agreed — a tutor who says the rate was 3,000 and a family who says
2,500, with nothing written down. A dual-acknowledgement record with a dispute path solves that
at zero cost and without claiming a capability the project does not have. Payment history feeds
neither public ranking nor public statistics, so no tutor can be advantaged by it.

The interface states plainly, wherever payment appears, that Ustaad.com does not process or hold
funds.

### SQLite in development, Supabase Postgres in production

Development runs against a local SQLite file; production runs against Supabase Postgres,
selected by the presence of one environment variable. Development starts immediately with no
provisioning, the deployment gets real persistence, and user data stays out of both the
repository and the ephemeral serverless filesystem. Supabase already holds the identity
documents, so no second provider is introduced.

The cost is that every query must survive the dialect change, and that cost is paid up front
rather than on deployment day:

- **One portable schema.** Every column is `text`, `integer` or `real` — the three builders
  whose semantics are identical in both dialects. Timestamps are ISO-8601 UTC text, booleans are
  integer 0/1, JSON is text, money is integer paisa, primary keys are application-generated.
- **The Postgres schema is *generated*** from the SQLite one, not hand-maintained, and a test
  fails if the mirror goes stale.
- **Exactly one file knows which engine is running.** No `PRAGMA` anywhere else, no
  `.returning()`, no `AUTOINCREMENT`, no database-side default, no `db.transaction()` outside
  the driver module — its callback is synchronous on one driver and asynchronous on the other.
- **`server/db/portability.test.ts` enforces all of it mechanically**, so the rules are checked
  rather than remembered.

`scripts/migrate-to-supabase.md` is the deployment-day runbook, with the rollback step.

---

## AI disclosure

Five AI components (§7). The architectural principle they are all subordinate to:

> **The model classifies, narrates and sequences. The application code computes, validates and
> enforces.**

Concretely: the model never emits a score, a price, a ranking, a rate, a date, a session count
or a constraint decision. Every number a user sees comes from a deterministic function over
stored structured signals. Agents *propose*; application code *enforces*. Ranking is
deterministic and reproducible; the narrator is handed a breakdown it did not compute, and a
narration that introduces a figure absent from that breakdown is discarded. Group matching is
constraint satisfaction, not model judgment. Study-plan prerequisite ordering is validated in
code after generation and regenerated on violation.

- **Prompts are versioned Markdown in `/prompts`**, loaded at runtime and never inlined in
  source. Every AI output row records the model id and the prompt version that produced it.
- **User text is data, not instructions.** Every prompt that receives user content instructs the
  model to disregard instructions embedded in it (SEC-11).
- **One chokepoint.** Every model call goes through `server/ai/call.ts`; one file reads a
  provider key. That is what makes the budget guard and the usage log complete rather than
  best-effort.
- **Every path degrades, never errors.** An exhausted budget, an unparseable response, or every
  provider being down hands the user the manual path with an explanation. Someone who has just
  described their child's difficulty must never get a stack trace.
- **The fallback chain is Gemini → Groq → a heuristic classifier.** The last link needs no key
  and no network, which is what makes the test suite deterministic and free.
- **`ai_call_log` records tokens, latency, cache hits and failovers — never a prompt and never a
  response.**

Reviews, biographies and session notes are stored byte-for-byte and **never machine-translated**
(decision 13). Urdu script, Roman Urdu and English mix freely within a sentence, and translating
a reviewer's words would misrepresent them. The *interface* is bilingual through an authored
string dictionary; the two are never confused.

---

## Commands

```
npm run dev            # API with tsx watch
npm run setup          # env + migrate + seed + demo seed
npm run db:reset       # migrate + both seeds
npm run db:seed:demo   # demonstration data, then the materialisation jobs
npm run jobs           # recompute every materialised table
npm run bench:search   # seed 500 tutors and print search p95 (NFR-1)
npm run docs:api       # regenerate docs/API.md from the Zod schemas
npm test               # vitest, including the portability and child-safety suites
npm run lint
npx tsc --noEmit
```

---

## Stack

React 18 + Vite · Tailwind · React Router v6 · TanStack Query · i18next · Recharts ·
Node + Express · **Zod** (schemas in `/shared`, used on both sides) · bcrypt + JWT in an httpOnly
cookie · **Drizzle ORM** · better-sqlite3 (dev) / postgres.js (prod) · Supabase Storage (private
bucket) · EmailJS · Gemini Flash → Groq Llama 3.3 → heuristic fallback · Netlify or Vercel.

> **Runtime note.** better-sqlite3 must be v12 or later: earlier versions have no prebuilt
> binary for Node 24 on Windows. If `npm install` dies in node-gyp, that is why.

## Out of scope, permanently

Payment processing, payouts, in-app chat, video calling, GPS or latitude/longitude, push
notifications, a native Android build, ML recommendation engines, gamification, and background
checks. **Area is the finest location granularity in this project.**

## Repository status

This is a **public repository**. It contains no user data, no credentials and no database file.
`.env`, `*.db` and the upload directory are gitignored, and `.env.example` carries placeholder
names only. Reference data — locations, subjects, topics, prerequisites, i18n strings — *is*
committed, because it is static and contains no user information.
