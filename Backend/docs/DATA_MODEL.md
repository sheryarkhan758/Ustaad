# Data Model — Ustaad.com

54 tables, specification §9.1–§9.10 plus `refresh_tokens` (§6.1) and the verification-integrity tables (§6.28). One line each: what it holds, and **who may read it**.

The visibility column is not documentation of an aspiration. It is the access rule the query
layer must enforce, and several of the rows below are safety controls rather than privacy
preferences — a trial fit check shown to a tutor stops being candid, a payment record joined
into a public profile leaks a family's finances, and an unmet-demand row carrying a requester
id stops being anonymous aggregate data and becomes a list of families.

**Reading key.** *Public* — visible without login. *Owner* — the account the row belongs to.
*Parties* — the two sides of one engagement. *Admin* — administrators only. *Internal* —
no user-facing surface at all; read by jobs and services.

---

## Reference data — §9.1

Static, seeded, read-only. Committed to the repository, because it holds no user information
(§12). Written only by `npm run db:seed`.

| Table | What it holds | Who may read |
|---|---|---|
| `provinces` | The eight top-level units of Pakistan, with official codes | Public |
| `cities` | Cities within a province | Public |
| `areas` | Localities within a city — **the finest location granularity in this system**; there is no GPS, lat/long or map anywhere (§4.2) | Public |
| `area_adjacency` | Symmetric within-city area pairs with a coarse travel-minutes estimate, for nearby-area expansion in search (FR-7.7) and group pooling | Public |
| `subjects` | Teachable subjects, English and Urdu names | Public |
| `levels` | Primary → Undergraduate, with academic sort order | Public |
| `boards` | Examination boards — **a first-class field, not a tag**: a Sindh Board tutor and a Cambridge tutor are not interchangeable (decision 5) | Public |
| `topics` | A teachable unit scoped to one (subject, level, board) triple, with its chapter citation | Public |
| `topic_prerequisites` | Directed acyclic graph of "requires first" edges — the structure the diagnostic agent walks to find the gap two chapters upstream (§2.4) | Public |
| `service_types` | Academic tuition, home tuition with mentoring, exam prep, concept clarification, assessment support (FR-3.7) | Public |
| `i18n_strings` | Authored interface copy keyed by (key, lang). **Not a translation service** — user-generated text is never machine translated (decision 13) | Public |

## Identity — §9.2

| Table | What it holds | Who may read |
|---|---|---|
| `users` | One row per account holder: parent, adult student, tutor, organisation, administrator. **No minor has a row here, ever** (SEC-1) | Owner + admin. `password_hash` and `token_version` never leave the server |
| `parent_profiles` | A parent's city, area and optional encrypted address | Owner + admin. `address_encrypted` never reaches a tutor or any public surface |
| `refresh_tokens` | One row per issued refresh token, stored as a SHA-256 hash and grouped into a family per login. Rotated on every use; reuse revokes the family. **No column can name a minor** — the only owner is `user_id` (SEC-1) | Internal. Never leaves the server |
| `student_profiles` | The learner. Exactly one of `parent_user_id` (a minor, parent-mediated) or `self_user_id` (an adult student) is set | Owner + admin. First name and area only are exposed to a tutor before a booking confirms (SEC-14) |

## Tutor — §9.3

| Table | What it holds | Who may read |
|---|---|---|
| `tutor_profiles` | Public profile, gender, modes taught, areas willing to travel to, volunteer flag, approval status. `draft` → `pending_verification` (tutor) → `approved` (administrator only). **Only `approved` is searchable** (FR-6.3) | Public once approved; owner + admin while draft |
| `tutor_subject_claims` | What a tutor **says** they can teach, per (subject, level, board). Recorded as `asserted`; **a claim is not competence** until Agent 2 has assessed it (§2.2). No tutor-facing endpoint can write `verified` | Public (status shown honestly); owner + admin |
| `tutor_rates` | Pricing rows with the normalised hourly equivalent computed on write, so incomparable quotes become comparable (§2.7) | Public |
| `tutor_documents` | Private-bucket keys for CNIC images, degrees and transcripts. **Never a public URL** | Admin only, via short-lived signed URLs, every access logged (SEC-7, NFR-9) |
| `tutor_availability` | Weekly recurring slots by weekday, `HH:MM` time, mode and optional area | Public |
| `tutor_safety_constraints` | A tutor's own conditions: female students only, guardian presence required, areas she will not travel to. **System-enforced, not displayed as preferences** (SEC-19) | Owner + admin; enforced invisibly in search for everyone |

## Booking and engagement — §9.5

| Table | What it holds | Who may read |
|---|---|---|
| `bookings` | One engagement: tutor, learner, curriculum, mode, area, agreed rate frozen at confirmation, status, and `decline_under_safety_constraint` | Parties + admin. `address_encrypted` is disclosed only after the tutor confirms (SEC-20) |
| `booking_slot_reservations` | One row per **live** booking, with a unique index on (tutor, slot start). That constraint — not application logic — is what makes two concurrent requests for the same slot resolve to one winner (FR-8.6). The row's absence *is* the slot being free | Internal |
| `session_notes` | Progress ledger: topics covered and a 1–5 mastery rating per topic, written by the tutor after a completed session (FR-12.1) | Parties + admin |
| `trial_fit_checks` | The family's private assessment after a trial session — communication, punctuality, engagement, pace, continue-or-not | **Requester + admin only.** Never the tutor, never public, never a ranking input (SEC-15) |

## Payment transparency — §9.6

**The platform records payments; it never processes them.** No gateway, no escrow, no fund
custody, no payout (§4.2, CLAUDE.md §2.6).

| Table | What it holds | Who may read |
|---|---|---|
| `payment_records` | Agreed amount and travel charge per cycle, plus each party's acknowledgement. Settled only when **both** have acknowledged; `agreed_amount` immutable thereafter (FR-31.1, FR-31.4) | **Parties + admin only.** Never public, never a ranking or statistics input (FR-31.12, SEC-22) |
| `payment_disputes` | Either party's stated disagreement, and the administrator's resolution with written reasoning | Parties + admin |

## Verification integrity — §6.6, §6.28

| Table | What it holds | Who may read |
|---|---|---|
| `verification_records` | One row per administrator decision, **ever** — track, decision, the artefacts checked itemised, the deciding administrator, timestamp and written reason. Never updated; a later decision points at the earlier one through `supersedes_id` (FR-6.6, FR-28.4) | Outcomes are public on the profile (FR-6.9, FR-28.9); reasons and administrator identity are admin-only |
| `cnic_registrations` | A **salted SHA-256 hash** of a CNIC, for duplicate detection only. **The number itself is stored nowhere in this system** (SEC-8, NFR-10). Not unique — a collision is flagged to an administrator, never auto-rejected (FR-28.7) | Internal. The hash never leaves the server and is never shown |
| `verification_appeals` | A tutor's appeal against a rejection or a failed verdict, once per decision after a seven-day cooling period, and the administrator's written override (FR-28.3, FR-28.6). *An automated verdict affecting a livelihood is never final* (decision 12) | Tutor (own) + admin; the fact an appeal occurred is public, its content is not (FR-28.9) |
| `notifications` | In-application notices — badge expiring, badge expired, decision made. Not in §9; added because FR-28.2 requires a thirty-day warning and §4.2 rules out push infrastructure | Owner only |
| `notification_dedupe` | One key per (claim, expiry date), so running the expiry job twice a day does not warn twice | Internal |

## Reviews — §9.8

| Table | What it holds | Who may read |
|---|---|---|
| `reviews` | One per completed booking (FR-9.1): a 1–5 rating and free text in any script, stored unchanged. `analysis_status` is `pending` → `analysed` \| `unanalysed`, so a failed model call never loses the review | Public, **except** where the analysis carries a safety flag |
| `review_analyses` | Eight structured dimensions with quoted evidence, credibility signals, and the model and prompt version that produced them. `content_hash` keys the zero-cost cache (FR-9.11) | `contradiction_flag` is **public** (FR-9.7); `generic_flag` and the weight are internal; `safety_concern_flag` and its reason are **admin-only** and the tutor is never notified (FR-9.8, SEC-9) |

## AI sessions and outputs — §9.8, §7

Every row carries the model identifier and prompt version, so the README's disclosure of the
prompt instructions is verifiable (§7.3). Nothing here is binding: **agents propose,
application code enforces** (§7.2).

| Table | What it holds | Who may read |
|---|---|---|
| `agent_sessions` | Per-turn state for the two multi-turn agents, since HTTP is stateless and they are not (FR-10.2). `is_demo_seed` marks a session replayed on the demonstration path at zero live cost | Owner + admin |
| `diagnostics` | The gap map, the explicit insufficient-information list, and the shortlist **after** hard constraints were applied in code to the tool result (FR-10.12) | Owner + admin |
| `verification_attempts` | Competency assessment items, responses, verdict and reasoning. Appealable and overridable by a human — an automated verdict affecting a livelihood is never final (SEC-18) | Tutor (own) + admin |
| `ranking_explanations` | Cached narration of a deterministic score breakdown, keyed by score hash and language. The narration may contain no figure absent from the breakdown (FR-22.4) | Public |
| `study_plans` | Generated plan, with `prereq_validated` recording that the ordering was re-checked against the prerequisite graph in code (FR-26.2) | Owner + admin |
| `ai_call_log` | One row per model call — day, component, provider, tokens, latency, whether it was a cache hit and whether it failed over. Holds the daily budget guard (§7.4). Stores **no prompt and no response**, because both quote user content | Admin |

## Group matching and demand — §9.7, §9.8

Deterministic constraint satisfaction, no AI (FR-23.7, decision 10).

| Table | What it holds | Who may read |
|---|---|---|
| `group_requests` | A family's willingness to be pooled: curriculum, area, area flexibility, gender preference, budget, availability | Owner + admin; first name and area only to other participants until the group confirms (SEC-14) |
| `group_proposals` | A candidate group offered to a tutor at a per-head rate, accepted or declined as a unit (FR-23.5). `group_key` is the sorted member request ids; `confirmed_at` is the **commit point** for the whole formation — the member bookings exist before it and are not a group until it is set | Participants + tutor + admin |
| `group_members` | Membership, each participant's explicit confirmation (a group forms only when every one has confirmed, FR-23.4), the linked booking, and `explanation_json` — why this family was grouped with these others, persisted as it was shown and naming no other family | Participants + admin |
| `unmet_demand` | A search that found nothing, reduced to subject, topics, level, board, area, gender preference and budget band. **Stores no requester identity, and none may be added** (FR-24.2) | Tutors and admins, **as counts only, suppressed below a cohort of three** (FR-24.5, FR-24.6, SEC-16) |

## Organisations, moderation and audit — §9.9

| Table | What it holds | Who may read |
|---|---|---|
| `org_profiles` | Academy or school profile, subject to the same administrator approval as a tutor (FR-6.11) | Public once approved; owner + admin before |
| `vacancies` | A posted vacancy: curriculum, mode, rate offered, area, status | Public (FR-13.6) |
| `vacancy_interests` | A tutor's one-action expression of interest, and the organisation's shortlist state | Organisation + the tutor concerned + admin |
| `flags` | A report against a profile, review, vacancy, booking or user — including against requesting families, not only tutors (SEC-10) | Admin only; the reporter's identity is never shown to the target |
| `admin_actions` | **The append-only audit log.** Every administrator decision with actor, action, target, timestamp and reasoning | Admin only. **Written by `appendAdminAction` alone; no application path issues an UPDATE or DELETE against it** (NFR-19, SEC-13) |

## Derived statistics — §9.4

**Written by background jobs only, never by a request handler** (NFR-15, decision 9). Their
whole purpose is that search does no arithmetic and makes no AI call, which is what keeps it
under 500 ms (NFR-1).

| Table | What it holds | Who may read |
|---|---|---|
| `tutor_scores` | Per-topic composite score, its dimension breakdown, whether the competency verdict is live, and the `score_hash` that keys the narration cache. One row per (tutor, topic) — the strongest claim wins where a topic appears in two | Public |
| `tutor_reliability` | Median response time, confirmation / on-time / completion / cancellation rates — with `safety_declines_excluded` and `booking_basis` stored so the SEC-21 exclusion is auditable rather than merely claimed | Public |
| `tutor_search_signals` | The query-independent half of ranking, rolled up per tutor: overall and best-topic score, artefacts checked, review counts, recency. Not in §9.4 — added so a search with no topic filter need not aggregate across topics at request time (NFR-15) | Public |
| `rate_benchmarks` | Median **and interquartile range** of the normalised hourly rate per (subject, level, area, mode), with `cohort_size` and a stored `published` flag | Public **only where `published`** — the SEC-17 cohort-of-four threshold is decided by the job, not by the reader (NFR-16) |

## Platform feedback and volunteers — §9.10

| Table | What it holds | Who may read |
|---|---|---|
| `platform_feedback` | What a user says about **Ustaad.com itself** — a broken layout, a wrong AI output, a search that returned nothing. `user_id` is NULL for anonymous submissions, which carry no identity fields at all | **Admin only. Never public, never tutor-visible, never a ranking input** (FR-32.10, SEC-26) |
| `volunteer_applications` | A public application to teach without a fee. Written **before** the EmailJS dispatch, with the dispatch outcome recorded, so a mail failure cannot lose an application (FR-33.9) | Admin only. `document_path` opens only through a short-lived signed URL (FR-33.4, SEC-24) |

---

## Conventions

These are the portability rules in miniature; the full set, with enforcement, is in
`server/db/PORTABILITY.md`.

- **Every column is `text`, `integer` or `real`** — no `boolean`, no `jsonb`, no `timestamp`
  type. Booleans are integer 0/1, JSON is serialised text, timestamps are ISO-8601 UTC text,
  all crossing the boundary through `shared/db-values.ts`.
- **Primary keys are text.** Reference tables use stable hand-authored slugs; entity tables use
  `randomUUID()` from application code. Nothing depends on a sequence, `rowid` or
  `AUTOINCREMENT`, so nothing breaks on the Postgres port.
- **Money is integer paisa** (1 PKR = 100 paisa) in every monetary column, with no exceptions.
  Scores, rates and ratios are `real`, because they are computed quantities rather than currency.
- **Timestamps are integer epoch milliseconds**, stamped from application code. User-supplied
  dates are ISO `YYYY-MM-DD` text; times of day are `HH:MM` text.
- **Foreign keys are enforced.** `server/db/index.ts` sets `foreign_keys = ON`, which SQLite
  leaves off by default and Postgres cannot turn off.
- **Free-text columns hold Urdu script, Roman Urdu, English or any mixture**, stored byte-for-byte
  as entered and never machine translated (CLAUDE.md §2.10).

## Rules the schema cannot express, and where they live

| Rule | Enforced in |
|---|---|
| Booking status transitions | `shared/booking-status.ts` + `server/services/bookings.ts` |
| `payment_records.agreed_amount` immutable once mutually acknowledged | `shared/payment-status.ts` + `server/services/payments.ts` |
| `admin_actions` append-only | `server/services/audit.ts` — the module exposes no update or delete |
| Exactly one owner on `student_profiles`; no account for a minor | `shared/student-profile.ts`, `shared/auth.ts`, `server/services/auth.ts` |
| Residential address decryptable in one module only | `server/services/address.ts`; the ciphertext is reachable only via `findBookingAddressCiphertext` |
| Tutor sees area before confirming, street after (SEC-20) | `server/services/address.ts#discloseAddress` |
| Role and resource-ownership checks on every protected route | `server/middleware/auth.ts` |
| No double booking, under concurrency | the unique index on `booking_slot_reservations`, plus a compensating delete in `server/services/booking-create.ts` |
| A female-only tutor cannot even be sent a request for a male student | `server/services/booking-create.ts` — refused before a booking row exists (SEC-19) |
| A volunteer cannot be booked past their declared weekly hours | `server/services/booking-create.ts` (FR-33.11) |
| Only `approved` tutors reach a family | `server/repositories/search.ts` — the sole module querying `tutor_profiles` for a public surface |
| Badge text can never imply a police or background check | `shared/badges.ts` — closed template set, validated interpolation, and a final guard over every emitted string |
| Every document view is logged, with no CNIC in the entry | `server/services/verification.ts#viewDocument` |
| A competency badge expires without removing the tutor from search | `server/services/verification-expiry.ts` |
| A payment record is created and its figures frozen at booking confirmation | `server/services/payment-records.ts#createPaymentRecordOnConfirmation` (FR-31.1) |
| Payment data never reaches a ranking or a public statistic | asserted behaviourally *and* structurally in `server/payments.flow.test.ts` (FR-31.12, SEC-22) |
| A dispute resolution is permanent, with actor, timestamp and reasoning | `server/services/payment-records.ts#resolveDispute` → `admin_actions` (FR-31.7) |
| A safety-flagged review is absent from public output, not redacted | `server/repositories/reviews.ts#listPublicReviewsForTutor` |
| A generic review is down-weighted but never hidden or deleted | `shared/review-analysis.ts#computeCredibility` (FR-9.6) |
| Review analysis never blocks a submission | `server/services/review-queue.ts` (FR-9.3) |
| Gender preference excludes in the SQL predicate, before ranking | `server/repositories/search.ts`; there is no gender term in `shared/ranking.ts` |
| Ranking is deterministic, model-free and reproducible | `shared/ranking.ts` — pure, fixed weights, id tiebreaker |
| Derived statistics are written by jobs only | `server/jobs/` — the only writers of the four materialised tables |
| A tutor cannot approve themselves, or verify their own claim | `shared/tutor-onboarding.ts` (no such field) + `server/services/tutor-onboarding.ts` |
| `normalised_hourly_amount` computed on every rate write | `server/services/tutor-onboarding.ts` via `shared/rates.ts` |
| Tutor safety constraints as booking-engine inputs | `server/services/tutor-onboarding.ts#checkEngagementAgainstConstraints` |
| `storage_path` points into the private bucket, never a URL | `shared/storage-path.ts` |
| Boolean / JSON / timestamp translation at the boundary | `shared/db-values.ts`, applied in `server/repositories/` |
| Gender preference as a hard exclusion from the result set | search service (§6.7, not yet built) |
| Cohort suppression: benchmarks < 4, unmet demand < 3 | recompute and aggregation jobs (not yet built) |

## Reconciling the two `bookings` column lists

The task brief and §9.5 name overlapping but not identical sets. `server/db/schema/booking.ts`
is the **union of both, with no column invented**. Names follow the brief where the two describe
the same field (`requested_by_user_id` for §9.5's `requester_user_id`, `topic_ids_json` for
`topics_json`, `guardian_presence_required` for `guardian_presence`).

`agreed_rate` / `rate_type` / `travel_charge_agreed` and `agreed_rate_snapshot_json` are both
kept and are not redundant: the scalars are what engagement statements and dispute views query;
the JSON is the frozen copy of the whole `tutor_rates` row as it stood at confirmation, which is
what makes FR-31.1's immutability claim auditable after a tutor edits their pricing.

`engagement_type` carries four values, not three: the brief names `monthly`, `single_session`
and `group`; §9.5 and §6.30 describe monthly, short-term package and single session. Dropping
`short_term_package` would strand the `package_sessions_*` columns §9.5 specifies, and dropping
`group` would strand `group_id`.
