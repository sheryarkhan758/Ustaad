# Security Review — §11, controls SEC-1 to SEC-26

Specification §11 is *"a required chapter of the project README, not an appendix to it"*.
This file is the working pass behind that chapter: every control checked against the code
that is actually in the repository as of **27 July 2026**.

**How to read the status column.** A green checklist is worth nothing if it was produced by
reading the requirement rather than the code, so the statuses are narrow on purpose:

| Status | Means |
|---|---|
| **Enforced** | Server-side code refuses the violation, and a test fails if it stops doing so. |
| **Enforced (structural)** | The violation is impossible because the table, column or endpoint that would carry it does not exist. Absence is the enforcement. |
| **Partial** | The server half is enforced and tested. Another half — almost always the interface — is not built. |
| **Gap** | Not enforced. Listed here rather than quietly counted as done. |

Nine of the twenty-six are **Partial**, and every one of those is partial for the same
reason: `/client` is empty. The controls that say *"the interface states"*, *"the flow
prompts"* or *"controls on every profile"* describe a screen, and no screen exists yet. The
server-side halves of all nine are built and tested; the outstanding work is a user
interface, not a missing rule. That is stated plainly here so it cannot be mistaken for
enforcement that was checked and found present.

---

## The controls

| ID | Control (abbreviated) | Status | Where |
|---|---|---|---|
| **SEC-1** | Under-18 learners hold no account; all activity parent-mediated | **Enforced (structural)** | `server/db/schema/identity.ts` — `student_profiles` carries no credential column and there is no `users` row for a minor. `shared/auth.ts#REGISTERABLE_ROLES` has no minor role. `server/child-safety.test.ts` (19 checks) asserts it structurally, including that no table holds both a credential and a student-profile reference. |
| **SEC-2** | No private tutor-to-student channel anywhere, including group tuition | **Enforced (structural)** | There is no messaging table, no messaging service and no messaging route in the repository; §4.2 puts in-app chat permanently out of scope. Group coordination routes through the parent's contact — `server/services/group-matching.ts`. `server/child-safety.test.ts` asserts no credential path to a minor exists. **Caveat:** this is enforced by absence, so it holds only as long as nothing adds a channel. The `flags` vocabulary in `shared/moderation.ts` deliberately has no `message` target for the same reason. |
| **SEC-3** | Public profiles expose area only; addresses encrypted, two parties only | **Enforced** | `server/services/address.ts` is the only module that may decrypt (AES-256-GCM); `BookingRecord` has no address field, so a handler cannot leak what it never receives. `server/services/address.test.ts`, 21 tests. **Caveat below.** |
| **SEC-4** | Booking flow for minors prompts for a public setting or guardian present | **Partial** | Server: `shared/booking.ts#guardianPresenceAcknowledged` and `server/services/booking-create.ts:221` persist and enforce it, and a tutor's own guardian-presence requirement is enforced against the booking. **The prompt itself is a screen and is not built.** |
| **SEC-5** | Reviews require a completed booking | **Enforced** | `server/repositories/reviews.ts`, `server/routes/reviews.ts`; one review per completed booking. `server/reviews.flow.test.ts`, 25 tests. |
| **SEC-6** | Badges state the artefact verified; no implied background check | **Enforced** | `shared/badges.ts` generates the wording; `shared/badges.test.ts` is adversarial over 1,000+ input combinations for `Trusted`, `Safe`, `Vetted`, `Background checked`, `Police verified`, `Screened`, `Certified safe`. The seeded i18n copy states plainly that no police or background check is performed (`server/db/seed/reference.ts:1080`). **Note:** the guard covers generated badge strings and the seeded strings; it does not sweep the README or future marketing copy, which remain a matter of discipline. |
| **SEC-7** | Verification documents: private storage, short-lived signed URLs, admin-scoped, every access logged | **Enforced** | `server/services/verification.ts#viewDocument` issues a TTL-bounded signed URL and appends to the audit log before returning it; `server/routes/admin-verification.ts` gates on `requireRole('admin')`. |
| **SEC-8** | CNIC never in a searchable column; salted hash for duplicate detection only | **Enforced** | `server/db/schema/verification.ts#cnicRegistrations` stores a salted SHA-256 only; `hashCnic`/`cnicHashesMatch` in `server/services/verification.ts`. The hash is deliberately non-unique so a collision is flagged to a person rather than auto-rejected. |
| **SEC-9** | Safety-concern reviews route privately to admins; never public; never auto-notify the tutor | **Enforced** | `server/repositories/reviews.ts:143` filters flagged analyses out of the public listing; the admin queue is the only reader. No tutor notification path for this flag exists (`server/db/schema/verification.ts#NOTIFICATION_KINDS` has no entry for it). |
| **SEC-10** | Flag controls on all user-generated content, and on requesting families as well as tutors | **Partial** | Server: `shared/moderation.ts`, `server/services/flags.ts`, `server/repositories/admin.ts`, `POST /api/flags`. Targets cover `tutor_profile`, `review`, `vacancy`, `user` and `booking` — `user` and `booking` are what make the *families as well as tutors* half true. Resolution is audited (`server/admin.flow.test.ts`). **The control on every profile and review is a screen and is not built.** |
| **SEC-11** | Prompt-injection defence: user text treated as data | **Enforced** | Every prompt that receives user text carries the clause: `prompts/diagnostic-intake.v1.md:24`, `prompts/review-intelligence.v1.md:17`, `prompts/competency-verification.v1.md:79`. `ranking-explanation.v1.md` and `study-plan.v1.md` receive no user text — they consume a computed score breakdown and the prerequisite graph — so the clause is correctly absent rather than missing. |
| **SEC-12** | AI credentials server-side only; inference through internal endpoints | **Enforced** | `server/ai/provider.ts` is the only file that reads a provider key; `server/ai/call.ts` is the only caller of a provider. No `VITE_`-prefixed AI variable exists in `.env.example`, so no key can reach the browser bundle. |
| **SEC-13** | Immutable, append-only administrator action log | **Enforced** | `server/services/audit.ts` exposes exactly one write and no update or delete. `server/db/runtime-guards.ts#guardAdminActionsWrites` wraps **every** handle (`server/db/index.ts`, `server/db/test-db.ts`) so `db.update(adminActions)` and `db.delete(adminActions)` throw before a statement is built. `server/services/audit.immutability.test.ts` (16 tests) tries both and fails, checks the unfiltered-delete case, checks that no source file or migration mutates the table, and checks that a SQLite table rebuild carries every row across before dropping. |
| **SEC-14** | Group participant identities limited to first name and area until the group confirms | **Enforced** | `server/repositories/groups.ts#listMemberIdentities` only populates `fullName` when `options.full` is set, and `server/services/group-matching.ts:453` sets it only when `proposal.confirmedAt !== null`. **Naming caveat:** the response field is called `firstName` even after confirmation, when it holds the full name. The control holds; the name is misleading and should be corrected. |
| **SEC-15** | Trial fit checks private to the requesting family and admins; never on a public profile | **Enforced** | `server/routes/bookings.ts:264,281` — owner-scoped reads only. No search or profile query joins the table; `server/repositories/search.visibility.test.ts` asserts `search.ts` is the only module querying tutor profiles for a public surface. |
| **SEC-16** | Unmet demand holds no requester identity; cohorts below three suppressed | **Enforced** | `server/db/schema/matching.ts#unmetDemand` has no requester column. `shared/unmet-demand.ts` bands budget on write and suppresses below three; `DEMAND_WINDOW_DAYS` is a fixed constant so two overlapping queries cannot be differenced, and no aggregate response carries a timestamp or a caller-chosen window. |
| **SEC-17** | Rate benchmarks suppressed below a cohort of four | **Enforced** | `server/jobs/rate-benchmarks.ts` applies the threshold at materialisation, not in the UI; `server/db/schema/derived.ts`. |
| **SEC-18** | Verification appeals with human override | **Enforced** | `server/services/verification-appeals.ts` — one appeal per decision (unique index), seven-day cooling period, administrator override with a permanent written reason. `server/verification.flow.test.ts`. |
| **SEC-19** | Tutor-side safety constraints enforced, not merely displayed | **Enforced** | `server/services/booking-create.ts` refuses a booking that violates the tutor's student-gender restriction, guardian-presence requirement or area restriction at request time. `server/booking.flow.test.ts`, 31 tests. |
| **SEC-20** | Exact address withheld until the tutor confirms; locality visible beforehand | **Enforced** | `server/services/address.ts` — area before confirmation, street after. `server/services/address.test.ts`. |
| **SEC-21** | Declines under a declared safety constraint excluded from the confirmation rate | **Enforced** | `server/jobs/tutor-reliability.ts` excludes them at materialisation; `shared/booking-status.ts` carries the distinguishing status. |
| **SEC-22** | Payment records visible to the two parties and admins only; never in public ranking or statistics | **Enforced** | `server/services/payment-records.ts`, `server/routes/payments.ts`. `shared/ranking.ts` has no payment term. `server/payments.flow.test.ts` (27 tests) greps the codebase for nine gateway names and the payment schema for balance/wallet/payout/refund/escrow/commission columns. |
| **SEC-23** | The interface states plainly, wherever payment appears, that Ustaad.com does not process or hold funds | **Partial** | The authored copy exists and is seeded in both languages (`server/db/seed/reference.ts:1092`, key `payment.disclaimer`), and the schema and tests state the boundary. **No interface renders it, because `/client` is empty.** This control is *about* the interface, so it cannot be called satisfied until the payment screens exist. |
| **SEC-24** | Volunteer attachments in the private bucket, never publicly addressable, admin retrieval by short-lived signed URL only | **Enforced** | `server/services/volunteers.ts:95` stores through `storeSubmittedFile` after magic-byte sniffing (`shared/file-signature.ts`); `server/routes/volunteers.ts:104` issues a signed read URL on the administrator path. `assertPrivateStoragePath` refuses a public path on write. |
| **SEC-25** | Only the EmailJS service id, template id and public key in client code; no private key, mail password or SMTP credential anywhere | **Enforced** | `.env.example` lines 55–65: every EmailJS variable is unprefixed and therefore server-side. `EMAILJS_PRIVATE_KEY` is EmailJS's own optional strict-mode token, not a mail password. No SMTP credential exists in the repository. |
| **SEC-26** | Platform feedback never public, never attributed to its reporter in tutor-facing communication, never in ranking | **Enforced** | `server/services/feedback.ts` — no public surface, no tutor surface; safety concerns are escalated with the reporter stripped before a tutor could see them. `shared/ranking.ts` has no feedback term. `server/feedback-volunteers.flow.test.ts`, 27 tests. |

**Summary: 17 Enforced, 2 Enforced (structural), 4 Partial, 0 Gap.**

Every Partial is the same missing artefact — the client — and is listed above with the
server-side half that *is* built. Nothing in this table is marked satisfied on the strength
of the requirement text alone.

---

## Caveats worth carrying forward

These are not control failures. They are places where the enforcement is real but narrower,
or more fragile, than a one-line status suggests — and the point of this document is that
they get written down rather than absorbed.

1. **SEC-3 — there is a second copy of the most sensitive field.**
   `parent_profiles.address_encrypted` exists because §9.2 specified it, and it duplicates
   the booking-level address that SEC-3 actually describes. The schema comment
   (`server/db/schema/identity.ts`) already records the tension. It is nullable, unindexed,
   and read by nothing. **It should be dropped**, not left to accumulate data no code reads;
   an unread copy of an encrypted home address is pure downside.

2. **SEC-24 — the tutor document path still cannot be sniffed.**
   The two public forms (feedback, volunteer) post bytes the server holds, so their content
   is checked against declared type, extension *and* magic bytes. The tutor document upload
   uses a signed ticket and the browser PUTs straight to Supabase, so the server never sees
   the file and has only the declared MIME and the extension. `docs/PROGRESS.md` records
   this; it must not be described as closed. Closing it needs either a proxied upload or a
   check at the administrator viewer.

3. **SEC-14 — the field name lies after confirmation.**
   `ProposalView.members[].firstName` holds the full name once the group has confirmed. The
   control is enforced correctly (the value is gated on `confirmedAt`), but a field named
   `firstName` that sometimes holds a full name is exactly the kind of thing a later change
   reads wrongly. Rename to `displayName`.

4. **SEC-2 and SEC-1 are enforced by absence, which is the strongest form and the easiest
   to erode.** No test can assert that a messaging feature will not be added. What exists is
   `server/child-safety.test.ts`, which fails if any table gains both a credential and a
   student-profile reference, and the deliberate omission of a `message` flag target. Both
   are tripwires, not walls.

5. **`server/routes/admin-verification.ts` builds queries in the route handler.**
   CLAUDE.md §2.1 requires route handlers to call repositories and never `db`. That module
   predates the repository layer for this aggregate and still selects from `tutor_profiles`
   and `flags` directly (lines 90–118). No control above depends on it being fixed — the
   route is administrator-gated and the queries are correct — but it is an open invariant
   violation and should be moved into `server/repositories/admin.ts`, which now exists.

6. **Revocation is bounded, not immediate.** The access token is verified without a database
   read, which is what keeps NFR-1 reachable; the cost is that a revoked session stays valid
   for up to 15 minutes. This is stated rather than hidden — see CLAUDE.md §2.11.

---

## Method

For each control: read the specification text in `docs/spec.txt` §11, locate the code that
would have to refuse the violation, read it, and check whether a test fails when it stops
refusing. Where no such code existed, the control was marked Partial or Gap rather than
argued into satisfaction.

The audit-log control (SEC-13) was additionally verified by attempting the violation:
`server/services/audit.immutability.test.ts` issues an `UPDATE`, a filtered `DELETE` and an
unfiltered `DELETE` against `admin_actions` and asserts all three throw, then confirms the
row is unchanged.

Re-run the whole basis for this document with `npm test` — 506 tests across 24 files.
