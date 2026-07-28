# Ustaad.com — Build Progress

**Update this file at the end of every task.** Tick a module only when it works completely:
every Must requirement implemented, reachable in the demonstration path, and describable in
one line in the README. A half-working module stays unticked — see CLAUDE.md §5.6.

> **Spec gap — the eight review dimensions.** FR-9.4 requires "eight defined
> dimensions" but §6.9 never defines them. `shared/review-analysis.ts` derives them:
> four verbatim from §2.5 (punctuality, teaching quality, syllabus command, confidence
> change), two from §6.20's named fit-check dimensions (communication, pace), and two
> closing the set (consistency, value for money). Worth confirming against your intent
> before the interface is built on them.

> **Count note.** The specification's front matter and §18 state "219 functional requirements
> across 32 modules". That figure is stale from v3.0. Counting the requirement tables in
> §6.1–§6.33 gives **287 functional requirements across 33 modules**. This checklist tracks
> the 33 modules that actually exist in the document.

---

## Foundation

- [x] Repository skeleton, `.gitignore`, `.env.example`, CLAUDE.md, PROGRESS.md
- [x] Drizzle configuration, database client (`server/db/index.ts`), migration runner
- [x] Reference-data schema (§9.1) — 11 tables, `server/db/schema/reference.ts`
- [x] Reference-data seed with seed-time validators — `server/db/seed/`
- [x] Prerequisite-graph walker — `scripts/print-prereq-chain.ts`
- [x] Identity schema (§9.2) — `users`, `parent_profiles`, `student_profiles`
- [x] Tutor schema (§9.3) — profiles, claims, rates, documents, availability, safety
- [x] Rate normalisation with unit tests — `shared/rates.ts`, 18 tests passing
- [x] Remaining schema (§9.4–§9.10) — booking, payment, feedback, ai, matching, admin,
      derived, platform. **46 tables total**, migrations apply clean, drizzle-kit reports
      no pending changes
- [x] `docs/DATA_MODEL.md` — one line per table: purpose and read access
- [x] Booking state machine — `shared/booking-status.ts` + `server/services/bookings.ts`
- [x] Payment immutability service — `server/services/payments.ts`, covered by tests
- [x] Append-only audit writer — `server/services/audit.ts` (no update/delete exists)
- [x] In-memory test harness — `server/db/test-db.ts`
- [x] Single database access point — `server/db/index.ts`, one file, two dialects,
      switched by `SUPABASE_DB_URL`
- [x] Portability rules written and **mechanically enforced** — `server/db/PORTABILITY.md`
      + `server/db/portability.test.ts` (8 rules, 13 checks)
- [x] Postgres schema mirror **generated**, not hand-maintained — `server/db/schema-pg/`
      via `npm run schema:pg`, drift-tested
- [x] Repository layer — `server/repositories/`, 6 aggregates. Route handlers call
      repositories and never touch `db`
- [x] Deployment runbook with rollback — `scripts/migrate-to-supabase.md`
- [x] Repository smoke test — insert/read/delete through every repository, JSON and
      boolean round-trip asserted
- [x] Auth: bcrypt (cost 12) registration, short-lived JWT access cookie + rotating
      refresh token with reuse detection, role and ownership middleware, rate limiting
- [x] Address encryption at rest (AES-256-GCM) and SEC-20 disclosure, in one service
- [x] Tutor onboarding (§6.4, §6.5, §6.29.2) — profile CRUD with slug collision handling,
      subject claims, rate table across all four shapes, availability templates, safety
      constraints, and signed-URL document upload with a gitignored local fallback
- [x] Verification module (§6.6, §6.28) — admin queue with stable sort, logged document
      views, approve/reject/request-info each with a written reason and itemised artefacts,
      badge generation with an adversarially-tested forbidden-phrase guard, competency
      expiry job, salted-hash CNIC duplicate detection, appeals with administrator override
- [x] Search and ranking (§6.7, §6.16, §6.17, §6.19) — `GET /api/search` with 13 filters,
      gender as a hard SQL exclusion, deterministic ranking with a returned breakdown,
      and three materialisation jobs in `server/jobs/`
- [x] **NFR-1 proven**: worst p95 of **30.44 ms** across four scenarios on a 500-tutor
      dataset (budget 500 ms). `npm run bench:search`
- [x] Booking (§6.8, §6.20, §6.30, §6.12) — slot generation from templates minus live
      bookings, all three engagement types, trial + private fit check, double-booking
      prevented by a unique index, server-side state machine returning 409, tutor safety
      constraints enforced at request time, volunteer hour cap, session notes
- [x] Reviews + AI classifier (§6.9) — one review per completed booking, async analysis
      that never blocks the POST, eight dimensions with quoted evidence, SHA-256 content
      cache, retry-once-then-`unanalysed`, safety routing, generic down-weighting,
      contradiction surfacing. Prompt is a versioned Markdown file
- [x] AI provider adapter with Gemini → Groq → heuristic failover; the heuristic link is
      NFR-11's non-AI fallback and is what makes the suite deterministic and free
- [x] All five AI components (§7) — JSON decision contract in `shared/ai-contract.ts`
      (decision 7, not native function calling); one chokepoint in `server/ai/call.ts`
      doing replay → demo guard → budget → failover → Zod parse with one retry → usage log;
      Agent 1 diagnostic intake with the shortlist **filtered in code after the tool call**;
      Agent 2 competency verification where the model classifies and `shared/competency.ts`
      scores; ranking narration cached on `score_hash` and discarded if it introduces a
      figure or a prohibited badge word; study plans validated against the prerequisite
      graph in code and regenerated on violation
- [x] §7.4 cost control — per-day call budget that degrades every AI path to the manual
      one, content-hash caching on narration, `DEMO_REPLAY=true` making a live call
      impossible rather than unlikely, per-component output-token caps, and `ai_call_log`
      recording tokens, latency, cache hits and failovers (but never a prompt or response)
- [x] Payment records (§6.31) — created and snapshotted at booking confirmation, dual
      acknowledgement, `agreed_amount` immutable after both confirm (409), dispute through
      to audited administrator resolution, parties-and-admins-only visibility, and a
      per-engagement statement. **No gateway, no escrow, no fund custody — record-keeping only**
- [x] Group tuition matching (§6.23) — opt-in requests, a **pure deterministic solver** in
      `shared/group-matching.ts` (no AI, decision 10) pooling on curriculum, topic overlap,
      area or adjacency with both sides flexed, a shared weekly window and the strictest
      gender requirement; a per-member explanation naming no other family; proposals at the
      tutor's own group rate; confirmation from every participant **and** the tutor before
      linked bookings are written; seven-day expiry
- [x] Unmet demand board (§6.24) — failed intakes logged with no requester identity, budget
      banded on write, cohorts below three suppressed, topics suppressed separately, and a
      **fixed** thirty-day window so two overlapping queries cannot be differenced
- [x] Platform feedback (§6.32) — anonymous or signed-in submission, page path, locale, role
      and version captured from the request, optional attachment sniffed and stored in the
      private bucket, administrator queue with an audited disposition, safety concerns
      escalated and stripped of the reporter before a tutor could see them (SEC-26). No
      public surface, no tutor surface, no ranking input
- [x] Volunteer programme (§6.33) — publicly reachable application with no account, PDF
      validated by extension **and** magic bytes (SEC-24), row written **before** the mail
      with the dispatch outcome recorded against it (FR-33.9), applicant acknowledgement in
      the same dispatch, administrator review, and conversion to a `draft` tutor account
      that must clear §6.6 verification before it is searchable
- [x] Content sniffing on bytes the server holds — `shared/file-signature.ts`. Covers both
      public forms; the ticket-based tutor upload still cannot be sniffed (see below)
- [x] Canonical searchable-tutor query — `server/repositories/search.ts`, the only module
      querying `tutor_profiles` for a public surface, enforced by a structural test
- [x] Administration (§6.14, §6.13, §6.12, §11) — administrator dashboard returning every
      count FR-14.3 names from live queries; flag and report queue with an audited,
      reason-bearing resolution that refuses to run twice; the Organisation module trimmed
      to decision 4 (profile with administrator approval, the same search endpoint parents
      use, vacancy posting, one-action interest) with **no applicant-tracking system**; the
      progress ledger completed with the diagnostic gap map against actual coverage
      (FR-12.3) and a stagnation indicator (FR-12.4); and `docs/SECURITY_REVIEW.md` mapping
      all 26 §11 controls to code or to an explicit shortfall
- [x] Demonstration seed and presentation layer (§6.15, §14.6) — `npm run db:seed:demo`
      writes 35 tutors across five cities in every verification state, families whose
      children hold no accounts, bookings in every lifecycle state with session notes and a
      private fit check, reviews whose credibility signals genuinely differ plus one
      safety-flagged review in the admin queue, payments in each status with a dispute under
      review, feedback and volunteer applications, one confirmed group, and five
      `is_demo_seed` agent sessions — then runs the materialisation jobs so no derived
      statistic is empty. Anonymous replay endpoints serve those sessions turn by turn and
      **import nothing from `server/ai/`**, so they work with every provider key deleted
      from `.env`. `npm run setup` takes a fresh clone to a working API in one command

**Tests: 520 passing** across 25 files — `shared/rates` (18), `shared/booking-status` (13),
`server/services/payments` (13), `server/db/portability` (13),
`server/repositories/repositories.smoke` (19), `server/routes/auth` (33),
`server/child-safety` (19), `server/services/address` (21),
`server/middleware/ownership` (15), `server/middleware/rate-limit` (4),
`server/repositories/search.visibility` (25), `server/routes/tutors` (20),
`shared/badges` (14), `server/verification.flow` (23), `server/search.ranking` (28), `server/booking.flow` (31), `server/reviews.flow` (25), `server/payments.flow` (27), `server/ai/ai.flow` (33), `server/group-matching.flow` (36), `server/feedback-volunteers.flow` (27),
`server/admin.flow` (16), `server/services/audit.immutability` (16), `shared/progress` (17).

> **§2.8 decision — the progress ledger computes in the request.** §2.8 requires derived
> statistics to be materialised, and `session_notes`' schema comment previously claimed a
> background job computed the mastery curve. It does not. §2.8's boundary is the NFR-1
> search path and the four tables it names, all of which feed public ranking; the ledger is
> one family reading one child's own notes, bounded by that child's booking count, feeding
> nothing. Materialising it would make it worse — a parent opening the page the evening
> after a session must see that session. The reasoning is set out in full at the top of
> `server/services/progress-ledger.ts` and the stale schema comment has been corrected.

### Seeded reference data

| Table | Rows |
|---|---|
| provinces | 7 (all four provinces, ICT, GB, AJK — FR-2.2) |
| cities | 6 (Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Hyderabad) |
| areas | 72 (12 per city, real localities) |
| area_adjacency | 180 (90 symmetric pairs, within-city, real proximity) |
| subjects | 7 | 
| levels | 7 |
| boards | 10 |
| topics | 202 (Sindh Board × 7 subjects × 2 levels; Punjab and Cambridge Mathematics) |
| topic_prerequisites | 183 (acyclic, board-scoped) |
| service_types | 5 |
| i18n_strings | 106 (53 keys × en/ur) |

Verified: `npm run db:generate && npm run db:migrate && npm run db:seed` against a fresh
`local.db`, then `npx tsx scripts/print-prereq-chain.ts` walks
signed-number arithmetic → algebraic factorisation → quadratic equations (§2.4).

**Still to seed** (FR-2.4, FR-3.5, FR-3.6): areas for Multan, Peshawar, Quetta,
Gujranwala, Sialkot, Sukkur, Bahawalpur, Sargodha, Abbottabad; non-Mathematics topics for
Punjab, Federal, KP, Balochistan, Aga Khan, Cambridge, Edexcel and IB; the
`exam_windows` table; and the non-academic service categories in FR-3.7 (Quran and
Islamiat, spoken English, skill-based instruction).

## Modules (§6)

| # | Module | Spec | FRs | Done |
|---|--------|------|-----|------|
| 1 | Authentication and accounts | §6.1 | 7 | partial — FR-1.1/1.2/1.3/1.5/1.6/1.7 done; FR-1.4 (parent manages student profiles) outstanding |
| 2 | Location taxonomy | §6.2 | 9 | partial — schema + seed done, FR-2.4 cities and FR-2.6 UI outstanding |
| 3 | Curriculum taxonomy | §6.3 | 7 | partial — schema + seed done, FR-3.6 exam windows and FR-3.7 categories outstanding |
| 4 | Tutor profile and portfolio | §6.4 | 12 | partial — CRUD, claims, documents done; FR-4.x display surfaces outstanding |
| 5 | Pricing and engagement types | §6.5 | 9 | partial — rate table + normalisation done; benchmarking UI outstanding |
| 6 | Verification and trust | §6.6 | 12 | [x] — the queue is now a screen, and it is the one that carries the platform's central claim. Documents open through a per-view signed URL logged against the administrator **before** it is issued (SEC-7); the artefact checklist is ticked item by item; and the public badge is previewed from `buildBadges` — the same function the public profile renders from, on the same input — so what is approved is literally what is published. There is no field on the screen to type a badge into, asserted by a test that walks every textbox. Approve, reject and request-more each require a written reason of at least fifteen characters, which is a better guard against a stray click than a confirmation dialogue and leaves an account behind that a confirmation would not |
| 7 | Search and discovery | §6.7 | 8 | partial — FR-7.1/7.3/7.4/7.5/7.7 done; FR-7.2/7.6 result-card and detail surfaces outstanding |
| 8 | Availability and booking | §6.8 | 11 | partial — FR-8.1/8.3/8.4/8.5/8.6/8.8/8.9/8.11 done; FR-8.2 exceptions, FR-8.7 WhatsApp link, FR-8.10 auto-trial outstanding |
| 9 | Feedback and review intelligence | §6.9 | 11 | partial — FR-9.1/9.2/9.3/9.4/9.5/9.6/9.7/9.8/9.9/9.10/9.11 done in the API and worker; the profile display surface outstanding |
| 10 | AI diagnostic intake — Agent 1 | §6.10 | 14 | [x] — the conversational surface now leads the landing page: turn-by-turn with a labelled waiting state, the session and transcript persisted so a dropped connection resumes, a gap map that puts the root gap first and draws the chain from reference data, and a shortlist under an explicit statement that gender, area and budget were applied in the SQL predicate after the model finished. Verified degrading to `insufficient_information` with the provider keys absent |
| 11 | AI competency verification — Agent 2 | §6.11 | 8 | partial — the tutor-facing examination is built: rules and stakes stated before she starts, the verdict shown with its reasoning quoting her own answers, an appeal route on a failure, and the statement that an administrator can overturn an automated result. FR-11.6 badges render per topic. Remaining: FR-11.8 re-attempt cooldown |
| 12 | Progress ledger | §6.12 | 4 | [x] — the ledger is now a screen. Mastery per topic over time as a Recharts line, where each topic stands now as a bar with the first rating behind the latest, the topic list in words, the diagnostic gap map against actual coverage (FR-12.3) and the FR-12.4 stagnation indicator named rather than left to be noticed. Built as a record a parent shows a relative rather than a dashboard: no invented score, every figure a rating a named verified tutor wrote, and the notes verbatim through `UserText`. RTL is handled where it actually bites — `chartAxes()` returns the `reversed` and `orientation` props **together**, since setting one without the other half-turns a chart, and it is tested as a rule because jsdom measures no geometry to assert against. The same figures are duplicated in a visually-hidden table, so the evidence survives a screen reader and a dropped chart |
| 13 | Organisation module | §6.13 | 7 | partial — trimmed exactly as decision 4 specifies. Profile with its approval state and the administrator’s written reason (FR-13.1), vacancy posting with rupees converted to paisa at the boundary (FR-13.3), the interested-tutor list (FR-13.4 read side), and the same tutor search parents get (FR-13.2). Status is the only mutation a posted vacancy allows, because a tutor read the curriculum and the rate before answering. **FR-13.5 is deliberately absent** — shortlisted/contacted/closed is the applicant-tracking system decision 4 removed, and the API has no route that could reach those states. FR-13.7 reads the same demand-board component a tutor does. Remaining: the FR-13.6 public browse surface |
| 14 | Moderation and administration | §6.14 | 9 | [x] — eight screens, built as an operations tool: tables over cards, one row per item, every queue one click from every other. Dashboard counts all link into the work they represent (FR-14.3). Flags, payment disputes with both parties' positions side by side, feedback triage with safety concerns fetched separately so a filter cannot bury them, volunteer applications, appeals, and a read-only audit viewer over the new `GET /api/admin/audit`. Every decision goes through one `ReasonForm`, so no queue can acquire a confirm-only action by accident. The volunteer approval states, above the button, that approving is not verifying — FR-33.10's failure mode is an administrator who believes otherwise |
| 15 | Demonstration and presentation layer | §6.15 | 10 | [x] — the five scenarios replay turn by turn at the presenter's pace, each labelled a recorded session and showing the server's own `liveModelCalls: 0`. Verified anonymous and provider-free end to end. The exhibit draws its prerequisite chain from reference data using the same component the live gap map uses |
| 16 | Gender preference filtering | §6.16 | 7 | partial — FR-16.1/16.2/16.3/16.4/16.6/16.7 done, FR-16.4 now asserted against an adversarial mock that names a male tutor; FR-16.5 (display) outstanding |
| 17 | Reliability statistics | §6.17 | 8 | partial — materialisation job done incl. SEC-21 exclusion; the three rates now display on the public profile as a single-series horizontal bar chart with a screen-reader table, a 5-engagement suppression floor and the SEC-21 exclusion stated at normal size. Remaining: the tutor's own private view of the same figures |
| 18 | Comparison tray | §6.18 | 5 | [x] — up to three tutors compared side by side on a normalised hourly basis |
| 19 | Rate benchmarking | §6.19 | 6 | partial — median + IQR job with SEC-17 suppression done; two-sided display outstanding |
| 20 | Trial session and fit check | §6.20 | 7 | partial — trial flag and the private fit check are now bookable and answerable from the UI: a completed trial prompts the family, the form states on itself that the tutor never sees it, and `GET /bookings/:id/fit-check` returns 404 to her (verified end to end). Remaining: the side-by-side comparison of two trials |
| 21 | Shareable profile and QR code | §6.21 | 6 | [x] — `/t/:slug` canonical, QR generated in the browser by `qrcode` (no third-party service ever sees a tutor's URL), WhatsApp as the one-tap primary share, Web Share API where it exists, and a print stylesheet that keeps only the code and the URL |
| 22 | Ranking explanation — AI component 4 | §6.22 | 8 | [x] — FR-22.1 to FR-22.5 done incl. the no-new-figure guard and the score-hash cache; the profile now renders the narration only when reached from a search (a rank is a property of a result set), frames it as a calculation rather than an opinion, and falls back to the breakdown table alone when the model is unavailable |
| 23 | Group tuition matching | §6.23 | 10 | partial — the surfaces exist. A family sees its open requests, what each one pooled with, and **why**: the solver now emits a reason code and its numbers beside every sentence, so decision 10’s promise that a family can be told why it was grouped survives the language toggle rather than stopping at English. A tutor sees incoming proposals with the per-head rate and the total, accepted or declined as a unit (FR-23.5) and with the same reasons shown to her. Identity stays first-name-and-area, with the limit stated where the names appear (FR-23.8). Remaining: the family-side create-a-request form, and accept/decline of a proposal from the family side |
| 24 | Unmet demand board | §6.24 | 7 | [x] — the board renders for tutors and, per FR-13.7, for organisations, from one component and one endpoint. Counts only, filterable on exactly the fields already in the cohort key so a filter can never carve a cohort below the threshold, with the fixed window and the suppression both stated on screen rather than left to be discovered. Suppressed cohorts are reported as a number, so the board never reads as complete when it is not. `POST /api/demand` now exists: the family-side one-tap post from an empty search was calling `/ai/intake/unmet-demand`, which never existed, so every such post had been failing silently |
| 25 | Examination countdown mode | §6.25 | 5 | [x] — days remaining, plan progress counted from the tutor's own session notes, and the single next topic. Stops counting once the date has passed rather than showing a negative figure |
| 26 | Study plan generation — AI component 5 | §6.26 | 7 | partial — FR-26.1/26.2/26.3/26.4 done and now rendered: a timeline in prerequisite order with the graph drawn beneath it, a badge distinguishing an ordering that was **checked** from one that merely looks ordered, and a note that the dates are the application's arithmetic rather than the model's. A read endpoint (`GET /api/ai/study-plans`) and a seeded plan make both screens work without spending a model call. Remaining: FR-26.5 revision surface and FR-26.6 export |
| 27 | Bilingual interface — English and Urdu | §6.27 | 7 | [ ] |
| 28 | Verification integrity controls | §6.28 | 9 | partial — FR-28.1/28.2/28.3/28.4/28.5/28.6/28.7/28.9 done; FR-28.8 (biography similarity) outstanding |
| 29 | Restricted-mobility home tuition and grooming | §6.29 | 16 | partial — the pathway exists as a pathway. `/home-tuition` is a first-class landing entry beside the diagnostic (FR-29.1, decision 15): three steps — area with adjacency, service category, guardian conditions — with female-only and home delivery stated as fixed rather than offered as filters, and results leading with which artefacts an administrator checked and on what date (FR-29.2/29.3, FR-6.5). FR-29.4 categories seeded and carried onto the booking; FR-29.7 defaults guardian presence on for a minor. Reciprocally: `GET /bookings/:id/engagement` gives her area, student gender, guardian and timing with **no address column selected at all** (FR-29.13, tested by asserting the serialised body contains no address rather than by naming today's fields), her conditions are shown as system-applied, and FR-29.14's exclusion of safety declines is stated on the screen where she decides. `checkEngagementAgainstConstraints` moved to `/shared` so the booking form runs the engine's own rule and a violating request cannot be submitted (FR-29.11). Remaining: FR-29.5 (tutors declaring their own categories — needs a `tutor_service_offerings` table before the category can filter rather than merely record), FR-29.8 travel-charge display before booking, FR-29.15 family flagging, FR-29.16 first-session prompt |
| 30 | Short-term and single-session engagements | §6.30 | 12 | partial — all three shapes now book **from the UI**, validated by the shared discriminated union so a single session with no declared purpose is not representable; presented at equal weight to monthly rather than as a downgrade. Remaining: per-session tracking within a package |
| 31 | Payment transparency and fraud prevention | §6.31 | 12 | partial — FR-31.1 to FR-31.7 and FR-31.10 to FR-31.12 done and now visible: a per-cycle ledger with the travel charge on its own line, both acknowledgements named separately, settlement only when both are present, and a dispute form. The SEC-23 boundary notice is one component used wherever payment appears, with a test asserting no pay button, card field or gateway exists in any payment or booking source file. Remaining: FR-31.8 downloadable statement (JSON only, no export) and FR-31.9 pattern indicator |
| 32 | Platform feedback and product improvement | §6.32 | 10 | [x] — the panel is complete and translated. A slide-over over the page the user is on, so a report never costs them a half-finished search (FR-32.1); category, detail, the optional 1–5 rating and a PNG/JPG/PDF attachment checked for type and size before a byte is read (FR-32.2, FR-32.5); anonymous submission stated plainly rather than inferred from the absence of a sign-in prompt (FR-32.6). The captured context — page, language, role, version — is listed on screen before sending: collecting it quietly is fine, hiding it is not (FR-32.4). The acknowledgement says what happens next and what a safety flag changes, not thanks. Honeypot and time-on-form travel with it, as the shared schema already required |
| 33 | Volunteer tutor programme | §6.33 | 11 | [x] — `/volunteer` is built, public, and linked from the footer and from the tutor registration path (FR-33.1). It opens with why the programme exists and states the verification standard before asking for anything, because FR-33.10 is the module’s load-bearing rule and nobody should meet it as a surprise. Zod validation against the shared schema with field errors and a focused summary, the shared location picker, subjects and levels. The PDF-only attachment is refused client-side by MIME type **and** extension, since `accept` is a filter on the file picker that a renamed file walks straight past — the server sniffs the bytes as well (SEC-24). Success is stated on the strength of the saved row: where the mail dispatch failed it says so as our problem and still confirms receipt, because an applicant shown a failure for an application that saved will re-apply or give up (FR-33.9). Honeypot and time-on-form, neither of which a real applicant ever meets |

**0 / 33 modules complete** — every module with a client surface stays unticked until it exists (§5.6). The API layer is substantially complete across 33 modules.

## Cross-cutting deliverables

- [~] Content sniffing on uploaded documents — **done on the two public forms**
      (`shared/file-signature.ts`, SEC-24): the server holds those bytes and checks the
      magic numbers before writing. Still outstanding on the tutor document path, where the
      browser PUTs straight to Supabase and the server never sees the file; that route has
      the declared MIME and the extension only. Sniffing it needs either a proxied upload or
      a check at the administrator viewer
- [ ] PWA shell: manifest, icon set, service worker, offline shell (NFR-8)
- [ ] Right-to-left Urdu layout verified across every screen (NFR-17)
- [x] Search under 500 ms against a 500-tutor dataset, measured (NFR-1) — worst p95 25.75 ms
- [x] Append-only audit log verified — no UPDATE or DELETE path exists (NFR-19)
- [~] Postgres migration **prepared** (§10.2) — `migrations-pg` generated (48 tables, 947 lines, statically clean), Netlify Function wrapper built and exercised, four dialect divergences audited and written up as PORTABILITY rules 9–13, and one real bug found and fixed (rate limiting threw `ERR_ERL_UNDEFINED_IP_ADDRESS` behind a Lambda event). **Not yet applied to a real Postgres** — see `docs/DEPLOYMENT.md`
- [ ] Public repository audited in a private browsing session; no secrets, no `.db`, no user
      data in history (NFR-13, NFR-4)
- [x] README with §11 security chapter, AI disclosure, the payment boundary, guest credentials (FR-15.9) and the three deliberate architectural decisions
- [x] `docs/API.md` — all 108 endpoints, **generated** from the Zod schemas; `npm run docs:api -- --check` fails if it drifts from the mounted application
- [ ] Live public URL (OBJ-17) — deployment artefacts and verification scripts ready; needs Supabase and Netlify credentials

## Invariant regression checks

Re-run these before every milestone. Each maps to a CLAUDE.md invariant.

- [ ] No hand-written SQL string in any route handler
- [ ] No SQLite-only function or `AUTOINCREMENT`/`rowid` assumption anywhere
- [ ] No credential, user data, or `.db` file tracked by git
- [ ] No log statement can emit a CNIC, password, token, or full address
- [x] No code path issues credentials to a minor — `server/child-safety.test.ts`, 19 checks
- [x] Gender preference excludes from the result set, in server code, in every search path — `search.visibility.test.ts`
- [x] Every verification record carries administrator id + timestamp — `verification.flow.test.ts`
- [x] No badge string implies a background, police, or safety check — `shared/badges.test.ts`, adversarial over 1,000+ input combinations
- [x] No gateway, escrow, payout, or fund-custody code exists — `payments.flow.test.ts` greps the whole codebase for nine gateway names and the payment schema for balance/wallet/payout/refund/escrow/commission columns
- [x] No UPDATE or DELETE against `admin_actions` — asserted across the whole verification path
- [x] Search path performs no aggregate computation and no AI call — asserted by emptying the materialised tables and checking the scores go to zero rather than being recomputed
- [ ] Every hard constraint is enforced in code after the model responds
- [ ] No machine translation of user-generated text anywhere
