/**
 * The declared half of `docs/API.md` — §14.6.
 *
 * Method, path, auth requirement, a one-line purpose, response sketch, error
 * codes, and the note worth reading before you call the endpoint. The *request
 * shapes* are not here: those are read out of the Zod schemas at generation
 * time by `scripts/generate-api-docs.ts`, so they cannot drift.
 *
 * ── Why this list is written by hand ───────────────────────────────────────
 * Express exposes no typed route table, and recovering paths by regex over the
 * router source would be a second source of truth that fails silently. So the
 * list is declared — and `npm run docs:api -- --check` walks the *real* mounted
 * application and fails if the two disagree in either direction: every route the
 * app serves must appear here, and every route here must exist. That check has
 * already caught this file inventing endpoints that were never built.
 *
 * `schema` points at the actual exported Zod schema. If a name is wrong, `s()`
 * returns `undefined` and the request table silently vanishes from the output —
 * so `--check` also asserts that every declared `schemaName` resolves.
 */

import type { z } from 'zod';

import * as authSchemas from '../shared/auth';
import * as bookingSchemas from '../shared/booking';
import * as feedbackSchemas from '../shared/feedback';
import * as groupSchemas from '../shared/group-matching';
import * as moderationSchemas from '../shared/moderation';
import * as organisationSchemas from '../shared/organisations';
import * as aiRequestSchemas from '../shared/ai-requests';
import * as searchSchemas from '../shared/search';
import * as studentSchemas from '../shared/student-profile';
import * as tutorSchemas from '../shared/tutor-onboarding';
import * as volunteerSchemas from '../shared/volunteers';

export type Auth =
  | 'anonymous'
  | 'any authenticated'
  | 'parent/student'
  | 'tutor'
  | 'organisation'
  | 'admin'
  | 'owner';

export interface RouteDoc {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: Auth;
  purpose: string;
  schema?: z.ZodTypeAny;
  schemaName?: string;
  schemaIn?: 'body' | 'query';
  response: string;
  errors?: string[];
  note?: string;
}

export interface Section {
  title: string;
  spec: string;
  blurb: string;
  routes: RouteDoc[];
}

/** Resolve a schema by name, so `--check` can report a typo rather than hide it. */
const s = (mod: Record<string, unknown>, name: string): z.ZodTypeAny | undefined =>
  mod[name] as z.ZodTypeAny | undefined;

export const SECTIONS: Section[] = [
  {
    title: 'Health and demonstration',
    spec: '§6.15',
    blurb:
      'Anonymous by requirement (FR-15.1). The demonstration routes reach no AI provider and need no API key — they read stored sessions, so a rate limit reached during assessment cannot take the demonstration down (FR-15.7, §15 risk table).',
    routes: [
      { method: 'GET', path: '/api/health', auth: 'anonymous', purpose: 'Liveness, version, and whether address encryption is configured.', response: '`{ status, version, addressEncryption }`', note: 'Address encryption is reported because an address cannot be stored or read without it, and discovering that after a family has typed one in is too late.' },
      { method: 'GET', path: '/api/demo/scenarios', auth: 'anonymous', purpose: 'The five "See it work" scenarios (FR-15.1).', response: '`{ items[], count, replay: { liveModelCalls: 0, note } }`' },
      { method: 'GET', path: '/api/demo/scenarios/:key', auth: 'anonymous', purpose: 'One scenario: transcript, provenance and exhibit.', response: '`{ scenario, replay }`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/demo/scenarios/:key/turns/:index', auth: 'anonymous', purpose: 'One turn of a stored session. 0-based and idempotent.', response: '`{ scenarioKey, index, turn, hasNext, totalTurns, liveModelCalls: 0 }`', errors: ['400 `validation_failed`', '404 `not_found`'], note: 'The turn number is a path parameter rather than stored progress, so two people demonstrating at once cannot share a cursor and step on each other.' },
    ],
  },
  {
    title: 'Authentication',
    spec: '§6.1',
    blurb:
      'Short-lived JWT access cookie (15 min) plus a rotating opaque refresh token (7 days) scoped to `/api/auth`. **The httpOnly cookie is the only accepted carrier** — there is deliberately no `Authorization` header path and no token in any URL, log line or `localStorage` (§2.11). `admin` is absent from the registerable roles by construction (FR-1.5), and no role for a minor exists (§2.3).',
    routes: [
      { method: 'POST', path: '/api/auth/register', auth: 'anonymous', purpose: 'Create a parent, student, tutor or organisation account.', schema: s(authSchemas, 'registerSchema'), schemaName: 'registerSchema', response: '`{ user }` and both session cookies', errors: ['400 `validation_failed`', '409 `email_taken`'], note: 'Registering as `student` means an **adult** student and requires a date of birth, checked in the schema and again in the service against an injected clock.' },
      { method: 'POST', path: '/api/auth/login', auth: 'anonymous', purpose: 'Exchange credentials for a session.', schema: s(authSchemas, 'loginSchema'), schemaName: 'loginSchema', response: '`{ user }` and both session cookies', errors: ['400 `validation_failed`', '401 `invalid_credentials`'], note: 'An unknown email, a wrong password and a malformed email all return the identical response — the endpoint is not an account-existence oracle.' },
      { method: 'POST', path: '/api/auth/refresh', auth: 'anonymous', purpose: 'Rotate the refresh token and reissue the access cookie.', response: 'both cookies reissued', errors: ['401 `refresh_invalid`'], note: 'Presenting an already-rotated token revokes the whole family and bumps `tokenVersion`: the server cannot distinguish a confused client from a stolen token, so it assumes the worse.' },
      { method: 'POST', path: '/api/auth/logout', auth: 'anonymous', purpose: 'Clear both cookies. Idempotent.', response: '`{ ok: true }`' },
      { method: 'GET', path: '/api/auth/me', auth: 'any authenticated', purpose: 'The current account.', response: '`{ user }`', errors: ['401 `authentication_required`'], note: 'Never returns a password hash or the token version.' },
    ],
  },
  {
    title: 'Reference data',
    spec: '§6.2, §6.3',
    blurb:
      '**Anonymous and heavily cached.** These taxonomies are the only genuinely static data in the system: seeded from committed files, containing no user information, changing only when somebody edits a seed and redeploys (§12). They carry a one-hour browser cache and a one-day shared cache, and the client fetches each list once per session — a picker that refetched the area list on every keystroke would spend a metered connection on data that cannot have changed.\n\n**There is no map, no pin and no coordinate in any of these responses.** Area is the finest granularity in this product (§4.2), and "neighbouring areas" is a hand-curated adjacency list rather than a distance calculation — which is the better answer in a city where two kilometres can be forty minutes.\n\nNames come back bilingual. `nameUr` is **nullable**: many Pakistani place names are habitually written in Latin even in Urdu text ("DHA", "F-10", "PECHS"), and inventing an Urdu spelling nobody uses would be worse than showing the familiar one. A null means "render `name` as it stands".',
    routes: [
      { method: 'GET', path: '/api/reference/provinces', auth: 'anonymous', purpose: 'All seven provinces and territories (FR-2.2).', response: '`{ items: [{ id, name, nameUr, code }] }`' },
      { method: 'GET', path: '/api/reference/cities', auth: 'anonymous', purpose: 'Cities, optionally filtered by `?provinceId=`.', response: '`{ items: [{ id, provinceId, name, nameUr }] }`' },
      { method: 'GET', path: '/api/reference/areas', auth: 'anonymous', purpose: 'Areas, optionally filtered by `?cityId=`.', response: '`{ items: [{ id, cityId, name, nameUr }] }`', note: 'Area is where location stops. There is no finer granularity in this system and no endpoint that returns one.' },
      { method: 'GET', path: '/api/reference/areas/adjacent', auth: 'anonymous', purpose: 'Areas neighbouring the given ones — `?ids=a,b` (FR-2.7).', response: '`{ items: [areaId] }`', errors: ['400 `validation_failed`'], note: 'A curated adjacency list, not a radius. The seed areas are excluded from the result: a caller asking what is next to Clifton does not mean Clifton.' },
      { method: 'GET', path: '/api/reference/subjects', auth: 'anonymous', purpose: 'All subjects.', response: '`{ items: [{ id, name, nameUr }] }`' },
      { method: 'GET', path: '/api/reference/levels', auth: 'anonymous', purpose: 'All levels, in curriculum order.', response: '`{ items: [{ id, name, sortOrder }] }`', note: 'Sorted by `sortOrder`, not alphabetically — Matric comes after Middle and before Intermediate, which no alphabet agrees with.' },
      { method: 'GET', path: '/api/reference/boards', auth: 'anonymous', purpose: 'All examination boards.', response: '`{ items: [{ id, name, nameUr }] }`' },
      { method: 'GET', path: '/api/reference/topics', auth: 'anonymous', purpose: 'Topics for one curriculum triple — `?subjectId=&levelId=&boardId=`.', response: '`{ items: [{ id, subjectId, levelId, boardId, name, nameUr, chapterRef, sortOrder }] }`', errors: ['400 `validation_failed`'], note: '**All three parameters are required.** Board is part of the curriculum, not a detail of it (decision 5): topics for a subject and level alone would be wrong for whichever board the family actually sits.' },
      { method: 'GET', path: '/api/reference/topics/prerequisites', auth: 'anonymous', purpose: 'The prerequisite graph reachable from `?ids=a,b` (§2.4, FR-3.4).', response: '`{ edges: [{ topicId, prerequisiteTopicId }], topics: [...] }`', errors: ['400 `validation_failed`'], note: 'Returns **edges**, not a tree. The §2.4 chain — quadratic equations depends on algebraic factorisation, which depends on signed-number arithmetic — is a path through a graph, and flattening it here would throw away the shape the client needs to draw. Walked breadth-first in code rather than by a recursive CTE, which would be the one query in this codebase that behaves differently on the two dialects.' },
      { method: 'GET', path: '/api/reference/service-types', auth: 'anonymous', purpose: 'Service categories (FR-3.7).', response: '`{ items: [{ id, name, nameUr }] }`' },
    ],
  },
  {
    title: 'Search and discovery',
    spec: '§6.7, §6.16',
    blurb:
      '**Anonymous — browsing and search require no login (FR-1.6).** Gender preference is a hard SQL exclusion applied before ranking: a non-conforming tutor is *absent from the result set*, never ranked lower and never merely greyed out (§2.4, FR-16.3). The search path performs no aggregate computation and makes no AI call; it is indexed SQL against materialised columns and returns in under 500 ms against a 500-tutor dataset (NFR-1 — measured worst p95, 30.44 ms).',
    routes: [
      { method: 'GET', path: '/api/search', auth: 'anonymous', purpose: 'Find tutors. Only identity-verified, approved profiles are searchable (FR-6.3).', schema: s(searchSchemas, 'searchQuerySchema'), schemaName: 'searchQuerySchema', schemaIn: 'query', response: '`{ results[], total }`, each result carrying its deterministic score breakdown', errors: ['400 `validation_failed`'], note: 'The default is `no_preference` — the system never pre-sets the gender filter on a caller’s behalf (FR-16.6).' },
    ],
  },
  {
    title: 'Tutor profile and onboarding',
    spec: '§6.4, §6.5, §6.29',
    blurb:
      'One anonymous read — `GET /api/tutors/public/:slug`, the profile a family sees — and the rest owner-scoped: they serve the tutor’s own view of their own profile, whatever its status. **No tutor-facing endpoint may write `approved`** — a tutor moves `draft → pending_verification` by submitting, and every transition after that belongs to an administrator (§2.5). A claim is an assertion until something tests it, so `claimStatus` is only ever `asserted` here.',
    routes: [
      { method: 'GET', path: '/api/tutors/public/:slug', auth: 'anonymous', purpose: 'The public profile a family reads — §6.4, §6.17, §6.21, §6.22.', response: '`{ tutor, rates[], claims[], availability[], reliability, normalisedHourly, benchmarkMedian, verification }`', errors: ['404 `not_found`'], note: 'The one anonymous route in this section (FR-1.6). It resolves the slug through the **searchable predicate**, so an unapproved tutor is not found at all (FR-6.3) — and an unknown slug and an unapproved tutor return the identical 404, because a distinguishable one would tell a stranger that a named person had applied and been turned down. Carries no CNIC, no document path, no email, no street address and no `verifiedScore`: the FR-11.5 rubric figure behind a competency verdict is internal. `reliability` and `benchmarkMedian` are read from tables a job materialised (§2.8); a null benchmark is the SEC-17 cohort suppression working, not missing data.' },
      { method: 'GET', path: '/api/tutors/profile', auth: 'tutor', purpose: 'Your own profile.', response: '`{ profile }`', errors: ['404 `not_found`'] },
      { method: 'POST', path: '/api/tutors/profile', auth: 'tutor', purpose: 'Create the profile. Slug collisions are resolved server-side.', schema: s(tutorSchemas, 'tutorProfileCreateSchema'), schemaName: 'tutorProfileCreateSchema', response: '`{ profile }`', errors: ['409 `profile_exists`'] },
      { method: 'PATCH', path: '/api/tutors/profile', auth: 'tutor', purpose: 'Edit the profile.', schema: s(tutorSchemas, 'tutorProfileUpdateSchema'), schemaName: 'tutorProfileUpdateSchema', response: '`{ profile }`' },
      { method: 'POST', path: '/api/tutors/profile/submit', auth: 'tutor', purpose: 'Submit for verification (`draft → pending_verification`).', response: '`{ profile }`', errors: ['409 `incomplete_profile`'] },
      { method: 'GET', path: '/api/tutors/claims', auth: 'tutor', purpose: 'Your subject claims.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/tutors/claims', auth: 'tutor', purpose: 'Claim a subject, level and board with topics. Board is part of the claim, not a detail of it (decision 5).', schema: s(tutorSchemas, 'subjectClaimSchema'), schemaName: 'subjectClaimSchema', response: '`{ claim }`' },
      { method: 'PATCH', path: '/api/tutors/claims/:id', auth: 'tutor', purpose: 'Edit a claim.', schema: s(tutorSchemas, 'subjectClaimSchema'), schemaName: 'subjectClaimSchema', response: '`{ claim }`', errors: ['404 `not_found`'] },
      { method: 'DELETE', path: '/api/tutors/claims/:id', auth: 'tutor', purpose: 'Withdraw a claim.', response: '`204`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/tutors/rates', auth: 'tutor', purpose: 'Your rate table.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/tutors/rates', auth: 'tutor', purpose: 'Add a rate. **Integer paisa** — 1 PKR = 100 paisa (§2.1).', schema: s(tutorSchemas, 'tutorRateSchema'), schemaName: 'tutorRateSchema', response: '`{ rate }`', note: 'Every rate is normalised to a comparable hourly figure by `shared/rates.ts` on write. That single converter is what makes benchmarking possible across four different pricing shapes.' },
      { method: 'PUT', path: '/api/tutors/rates/:id', auth: 'tutor', purpose: 'Replace a rate.', schema: s(tutorSchemas, 'tutorRateSchema'), schemaName: 'tutorRateSchema', response: '`{ rate }`', errors: ['404 `not_found`'] },
      { method: 'DELETE', path: '/api/tutors/rates/:id', auth: 'tutor', purpose: 'Remove a rate.', response: '`204`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/tutors/availability', auth: 'tutor', purpose: 'Your weekly availability template.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/tutors/availability', auth: 'tutor', purpose: 'Add an availability window.', schema: s(tutorSchemas, 'availabilitySlotSchema'), schemaName: 'availabilitySlotSchema', response: '`{ slot }`' },
      { method: 'DELETE', path: '/api/tutors/availability/:id', auth: 'tutor', purpose: 'Remove an availability window.', response: '`204`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/tutors/safety', auth: 'tutor', purpose: 'Your declared safety constraints.', response: '`{ constraints }`' },
      { method: 'PUT', path: '/api/tutors/safety', auth: 'tutor', purpose: 'Student-gender restriction, guardian-presence requirement, area restrictions.', schema: s(tutorSchemas, 'safetyConstraintsSchema'), schemaName: 'safetyConstraintsSchema', response: '`{ constraints }`', note: 'These are **enforced by the system at booking time**, not merely displayed (SEC-19). Declines made under a declared constraint are excluded from your confirmation-rate statistic, so holding to them costs you nothing (SEC-21).' },
      { method: 'GET', path: '/api/tutors/documents', auth: 'tutor', purpose: 'Your uploaded verification documents — metadata only.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/tutors/documents/ticket', auth: 'tutor', purpose: 'A short-lived signed upload URL.', schema: s(tutorSchemas, 'uploadTicketRequestSchema'), schemaName: 'uploadTicketRequestSchema', response: '`{ uploadUrl, storagePath, expiresInSeconds }`', note: 'The browser PUTs straight to storage, so the server never holds the bytes and **cannot sniff them**. That gap is recorded under SEC-24 in `docs/SECURITY_REVIEW.md` and must not be described as closed.' },
      { method: 'POST', path: '/api/tutors/documents', auth: 'tutor', purpose: 'Confirm an upload completed and record the document.', schema: s(tutorSchemas, 'confirmDocumentSchema'), schemaName: 'confirmDocumentSchema', response: '`{ document }`' },
      { method: 'DELETE', path: '/api/tutors/documents/:id', auth: 'tutor', purpose: 'Remove a document.', response: '`204`', errors: ['404 `not_found`'] },
      { method: 'POST', path: '/api/tutors/cnic', auth: 'tutor', purpose: 'Register a CNIC for duplicate detection.', response: '`{ duplicateFlagged }`', note: '**The number is never stored, anywhere, in any column.** A salted SHA-256 hash supports exactly one question — has this document been used on another account — and supports no other (SEC-8, NFR-10). The hash is deliberately not unique: a collision is flagged to an administrator, because a machine cannot tell fraud from a family member re-registering after a failed signup.' },
      { method: 'GET', path: '/api/tutors/verification', auth: 'tutor', purpose: 'Your verification history and current badges.', response: '`{ records[], badges[] }`' },
      { method: 'POST', path: '/api/tutors/appeals', auth: 'tutor', purpose: 'Appeal a rejection or a failed competency verdict.', response: '`{ appeal }`', errors: ['409 `appeal_not_yet_eligible`', '409 `already_appealed`'], note: 'Appealable **once**, after a seven-day cooling period (FR-28.3). An automated verdict affecting a livelihood is never final without a route to human review (SEC-18, decision 12).' },
    ],
  },
  {
    title: 'Booking',
    spec: '§6.8, §6.20, §6.30',
    blurb:
      'The state machine lives server-side and returns **409** on an illegal transition. A minor is never the requester — a parent is (SEC-1, SEC-2). The delivery address is captured on a confirmed booking, encrypted with AES-256-GCM, and readable only by the two parties; the tutor sees the **area** before she confirms and the **street** only after (SEC-20). `server/services/address.ts` is the only module that may decrypt one, and `BookingRecord` has no address field at all — a handler cannot leak what it never receives.',
    routes: [
      { method: 'GET', path: '/api/bookings/slots', auth: 'any authenticated', purpose: 'Free slots for a tutor: the availability template minus live bookings.', schema: s(bookingSchemas, 'slotQuerySchema'), schemaName: 'slotQuerySchema', schemaIn: 'query', response: '`{ slots[] }`' },
      { method: 'GET', path: '/api/bookings', auth: 'any authenticated', purpose: 'Your bookings, as family or as tutor.', response: '`{ items[] }`' },
      { method: 'GET', path: '/api/bookings/:id', auth: 'owner', purpose: 'One booking.', response: '`{ booking }`', errors: ['404 `not_found`'] },
      { method: 'POST', path: '/api/bookings', auth: 'parent/student', purpose: 'Request a booking — monthly, short-term package, single session or group.', schema: s(bookingSchemas, 'createBookingSchema'), schemaName: 'createBookingSchema', response: '`{ booking }`', errors: ['400 `validation_failed`', '409 `slot_taken`', '409 `tutor_constraints_not_met`', '409 `volunteer_cap_reached`'], note: 'Double-booking is prevented by a unique index, not by a check-then-write. The tutor’s declared safety constraints are enforced here, at request time.' },
      { method: 'POST', path: '/api/bookings/:id/transition', auth: 'owner', purpose: 'Confirm, decline, start, complete, cancel or mark a no-show.', schema: s(bookingSchemas, 'transitionBookingSchema'), schemaName: 'transitionBookingSchema', response: '`{ booking }`', errors: ['404 `not_found`', '409 `illegal_transition`'] },
      { method: 'GET', path: '/api/bookings/:id/notes', auth: 'owner', purpose: 'Session notes for this booking.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/bookings/:id/notes', auth: 'tutor', purpose: 'Record a session note: topics covered and a 1–5 mastery rating each (FR-12.1).', schema: s(bookingSchemas, 'sessionNoteSchema'), schemaName: 'sessionNoteSchema', response: '`{ note }`' },
      { method: 'GET', path: '/api/bookings/:id/fit-check', auth: 'owner', purpose: 'The trial fit check, if one was submitted.', response: '`{ fitCheck }`' },
      { method: 'POST', path: '/api/bookings/:id/fit-check', auth: 'parent/student', purpose: 'Submit a trial fit check.', schema: s(bookingSchemas, 'trialFitCheckSchema'), schemaName: 'trialFitCheckSchema', response: '`{ fitCheck }`', note: '**Private to the requesting family and administrators.** Never shown to the tutor, never on a public profile, never a ranking input — that privacy is what keeps it candid (SEC-15, decision 11).' },
    ],
  },
  {
    title: 'Student profiles',
    spec: '§6.2, SEC-1',
    blurb:
      '**A learner is a row here, and nowhere else.** There is no `users` row for a minor, no credential, no session, no login path and no invitation path — the absence is the enforcement (§2.3), asserted structurally by `server/child-safety.test.ts`. Ownership is decided by the **caller’s role**, never by the request body: a parent’s POST produces a parent-owned profile and an adult student’s produces a self-owned one, so “register my child as an adult” is not a request that can be expressed rather than one that is refused.',
    routes: [
      { method: 'GET', path: '/api/students', auth: 'parent/student', purpose: 'Every learner this account is responsible for.', response: '`{ items: [{ id, name, gender, levelId, boardId, schoolName, dateOfBirth, parentOwned, createdAt }] }`' },
      { method: 'POST', path: '/api/students', auth: 'parent/student', purpose: 'Add a learner. Creates a profile, never an account.', schema: s(studentSchemas, 'createStudentProfileSchema'), schemaName: 'createStudentProfileSchema', response: '`{ profile }`', errors: ['400 `validation_failed`', '400 `invalid_ownership`'], note: 'The schema carries no `parentUserId` or `selfUserId` field. `invalid_ownership` is what an adult student gets for entering a date of birth under 18 — a safety rule, not a validation quibble.' },
      { method: 'GET', path: '/api/students/:id', auth: 'parent/student', purpose: 'One learner, if this account owns them.', response: '`{ profile }`', errors: ['404 `not_found`'], note: 'A profile that does not exist and one belonging to another family return the **identical 404** — 403 would confirm the id names a real child.' },
      { method: 'PATCH', path: '/api/students/:id', auth: 'parent/student', purpose: 'Amend a learner’s details.', schema: s(studentSchemas, 'updateStudentProfileSchema'), schemaName: 'updateStudentProfileSchema', response: '`{ profile }`', errors: ['404 `not_found`'], note: 'Ownership columns are not in the patch and cannot be reached from here — a profile never changes hands, because the two shapes that would need it are the two §2.3 forbids.' },
    ],
  },
  {
    title: 'Progress ledger',
    spec: '§6.12',
    blurb:
      'Per-student mastery over time, assembled from session notes and the verification record of the tutor who wrote each one, with the original diagnostic gap map set against actual coverage (FR-12.3) and a stagnation indicator where a topic shows three or more sessions with no increase (FR-12.4).',
    routes: [
      { method: 'GET', path: '/api/students/:studentProfileId/progress', auth: 'owner', purpose: 'The ledger. Owning parent, adult self-managing student, or an administrator.', response: '`{ ledger: { entries[], topics[], gapCoverage[], stagnantTopicIds[], summary } }`', errors: ['404 `not_found`'], note: 'A profile that does not exist and one belonging to another family both return **404** — never 403, which would make the endpoint an existence oracle over student ids. The tutor who taught the sessions cannot read the ledger either.' },
    ],
  },
  {
    title: 'Reviews',
    spec: '§6.9',
    blurb:
      'A review requires a **completed booking** and is therefore traceable to a real interaction (SEC-5). Analysis is asynchronous and never blocks the POST; a malformed model response is retried once, then the record is marked `unanalysed` and the work moves on — a bad response must never lose the user’s data. A generic review is **down-weighted, never hidden and never deleted** (FR-9.6). A rating that contradicts its own text is surfaced **publicly** (FR-9.7). A safety concern routes privately to the administrator queue and never triggers an automatic notification to the tutor (SEC-9).',
    routes: [
      { method: 'POST', path: '/api/reviews', auth: 'parent/student', purpose: 'Leave one review for a completed booking.', response: '`{ review }`', errors: ['400 `validation_failed`', '409 `already_reviewed`', '409 `booking_not_completed`'] },
      { method: 'GET', path: '/api/reviews/:id', auth: 'any authenticated', purpose: 'One review with its analysis.', response: '`{ review, analysis }`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/reviews/tutor/:tutorId', auth: 'anonymous', purpose: 'Public reviews for a tutor.', response: '`{ items[], count }`', note: 'Safety-flagged reviews are filtered out in the repository, not in the interface (SEC-9).' },
      { method: 'GET', path: '/api/reviews/admin/safety-queue', auth: 'admin', purpose: 'Reviews an analysis flagged as a safety concern (FR-9.8).', response: '`{ items[] }`' },
    ],
  },
  {
    title: 'Payments — records only',
    spec: '§6.31',
    blurb:
      '**Ustaad.com does not process or hold funds.** There is no gateway, no escrow, no payout, no commission, no wallet and no refund flow, and there never will be (§2.6). What exists is a record: the agreed rate and rate type frozen at confirmation, dual acknowledgement, and an administrator dispute path. A payment is `settled` only when **both** parties have acknowledged it; a single-party claim displays as unconfirmed (FR-31.4). Payment history contributes to neither public ranking nor public statistics (FR-31.12, SEC-22).',
    routes: [
      { method: 'GET', path: '/api/payments/:id', auth: 'owner', purpose: 'One payment record. The two parties and administrators only.', response: '`{ record }`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/payments/bookings/:bookingId', auth: 'owner', purpose: 'Every record for one engagement — the per-engagement statement (FR-31.8).', response: '`{ items[], totals }`' },
      { method: 'PATCH', path: '/api/payments/:id', auth: 'owner', purpose: 'Amend a record before both parties have confirmed.', response: '`{ record }`', errors: ['409 `agreed_amount_immutable`'], note: '`agreedAmount` becomes immutable once both parties have acknowledged, and the endpoint returns 409 rather than silently ignoring the change.' },
      { method: 'POST', path: '/api/payments/:id/mark-paid', auth: 'parent/student', purpose: 'The family records that it has paid.', response: '`{ record }`', note: 'On its own this is a claim, not a settlement — it displays as unconfirmed until the tutor agrees.' },
      { method: 'POST', path: '/api/payments/:id/confirm-received', auth: 'tutor', purpose: 'The tutor confirms receipt. This is what settles it.', response: '`{ record }`' },
      { method: 'POST', path: '/api/payments/:id/disputes', auth: 'owner', purpose: 'Raise a dispute.', response: '`{ dispute }`' },
      { method: 'GET', path: '/api/payments/admin/disputes', auth: 'admin', purpose: 'Open and under-review disputes.', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/payments/admin/disputes/:disputeId/resolve', auth: 'admin', purpose: 'Resolve with written reasoning. Audited (FR-31.7).', response: '`{ dispute }`' },
    ],
  },
  {
    title: 'Group tuition',
    spec: '§6.23',
    blurb:
      '**Opt-in only** — nothing outside `createGroupRequest` writes a `group_requests` row. Pooling is a pure deterministic function with no database, no clock, no randomness and no AI (FR-23.7, decision 10), so a family can be told exactly why it was grouped with these students. Every hard constraint must agree between **every pair** of members, not merely between each member and the seed. A group carries the **strictest** gender requirement any member stated and never relaxes one. `group_proposals.confirmed_at` is the commit point: a set of bookings is not a group until that column is set (§2.12).',
    routes: [
      { method: 'POST', path: '/api/groups/requests', auth: 'parent/student', purpose: 'Opt in to group matching.', schema: s(groupSchemas, 'createGroupRequestSchema'), schemaName: 'createGroupRequestSchema', response: '`{ request }`' },
      { method: 'GET', path: '/api/groups/requests', auth: 'parent/student', purpose: 'Your own group requests.', response: '`{ items[] }`' },
      { method: 'DELETE', path: '/api/groups/requests/:id', auth: 'parent/student', purpose: 'Withdraw a request.', response: '`204`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/groups/requests/:id/matches', auth: 'parent/student', purpose: 'Candidate groups from the solver, with a per-member explanation.', response: '`{ candidates[] }`', note: 'An explanation names no other family — counts and constraints only (FR-23.8).' },
      { method: 'POST', path: '/api/groups/proposals', auth: 'parent/student', purpose: 'Propose a group to a tutor.', schema: s(groupSchemas, 'proposeGroupSchema'), schemaName: 'proposeGroupSchema', response: '`{ proposal }`', note: 'The group is **re-derived from the solver** before it is proposed, never trusted from the request body — otherwise a caller could assemble a group the constraints forbid simply by not asking.' },
      { method: 'GET', path: '/api/groups/proposals', auth: 'tutor', purpose: 'Proposals awaiting your response.', response: '`{ items[] }`' },
      { method: 'GET', path: '/api/groups/proposals/:id', auth: 'any authenticated', purpose: 'One proposal with per-member explanations.', response: '`{ proposal, members[] }`', errors: ['404 `proposal_not_found`'], note: 'Member identities are limited to **first name and area** until the group confirms (SEC-14).' },
      { method: 'POST', path: '/api/groups/proposals/:id/respond', auth: 'parent/student', purpose: 'Confirm or decline your place.', response: '`{ proposal }`', note: 'A family pooled into a stricter group is told so in its explanation, before it confirms.' },
      { method: 'POST', path: '/api/groups/proposals/:id/tutor-response', auth: 'tutor', purpose: 'Accept or decline the group, at your own group rate.', response: '`{ proposal }`', note: 'The group’s gender requirement is enforced against you in code — the same hard exclusion search applies (§2.4, §2.12).' },
    ],
  },
  {
    title: 'Unmet demand board',
    spec: '§6.24',
    blurb:
      'Records carry **no requester identity** and cohorts below three are suppressed (SEC-16). `DEMAND_WINDOW_DAYS` is a fixed constant and must stay one: a board you can query at 29 days and again at 30 hands the caller the records in between, and a threshold of three protects nothing against someone who can subtract. No response carries a timestamp, an ordering by recency, or a caller-chosen window, and every field a caller may filter on is already part of the cohort key — so a filter selects whole cohorts and can never slice one.',
    routes: [
      { method: 'GET', path: '/api/demand', auth: 'tutor', purpose: 'The demand board as supply intelligence (FR-24.3). Also open to organisations as hiring intelligence (FR-13.7) and to administrators.', response: '`{ cohorts[] }`', note: 'Note the absence of a `windowDays`, a `since`, an `until`, a `limit` and an `order`. Every one of those would let a caller vary the population between two requests and read the difference.' },
      { method: 'GET', path: '/api/demand/supply-gaps', auth: 'admin', purpose: 'The administrator supply-gap view, same suppression (FR-24.4).', response: '`{ gaps[] }`' },
    ],
  },
  {
    title: 'Organisations and vacancies',
    spec: '§6.13',
    blurb:
      'Trimmed by **decision 4** to search plus an interest-based vacancy board. **FR-13.5 is deliberately not built** — marking an interest shortlisted, contacted or closed is an applicant-tracking system, and no endpoint reaches those states. FR-13.2 has no route of its own on purpose: an organisation calls `GET /api/search` exactly as a parent does, so there is no second code path that could drift from the gender filter §2.4 forbids relaxing.',
    routes: [
      { method: 'PUT', path: '/api/organisations/me', auth: 'organisation', purpose: 'Create or edit the organisation profile (FR-13.1).', schema: s(organisationSchemas, 'upsertOrgProfileSchema'), schemaName: 'upsertOrgProfileSchema', response: '`{ organisation }`', note: 'Editing never grants approval — the approval columns are not in the update set. An organisation cannot approve itself, for the same reason a tutor cannot (FR-6.11, §2.5).' },
      { method: 'GET', path: '/api/organisations/me', auth: 'organisation', purpose: 'Your own profile, approved or not.', response: '`{ organisation }`', errors: ['404 `not_found`'] },
      { method: 'GET', path: '/api/organisations/:id', auth: 'anonymous', purpose: 'Public organisation profile.', response: '`{ organisation }`', errors: ['404 `not_found`'], note: 'An unapproved organisation reads as **404, not 403** — a 403 would confirm the account exists to someone who only guessed the id.' },
      { method: 'POST', path: '/api/organisations/me/vacancies', auth: 'organisation', purpose: 'Post a vacancy (FR-13.3).', schema: s(organisationSchemas, 'createVacancySchema'), schemaName: 'createVacancySchema', response: '`{ vacancy }`', errors: ['403 `org_not_approved`', '404 `org_profile_missing`'], note: 'An unapproved organisation may not post. Otherwise the approval gate buys nothing: an account could register, skip verification, and publish a vacancy that tutors answer.' },
      { method: 'GET', path: '/api/organisations/me/vacancies', auth: 'organisation', purpose: 'Your vacancies, any status.', response: '`{ items[], count }`' },
      { method: 'PATCH', path: '/api/organisations/me/vacancies/:id', auth: 'organisation', purpose: 'Close or reopen. Status is the only editable field.', schema: s(organisationSchemas, 'updateVacancyStatusSchema'), schemaName: 'updateVacancyStatusSchema', response: '`{ vacancy }`', errors: ['404 `not_found`'], note: 'Curriculum, rate and area stay as the tutors who answered read them. Rewriting a vacancy under the people who answered it is not an honest operation.' },
      { method: 'GET', path: '/api/organisations/me/vacancies/:id/interests', auth: 'organisation', purpose: 'Who expressed interest. Read-only — there is deliberately no PATCH counterpart.', response: '`{ items[], count }`' },
      { method: 'GET', path: '/api/vacancies', auth: 'anonymous', purpose: 'The public board: open vacancies from approved organisations (FR-13.6).', schema: s(organisationSchemas, 'browseVacanciesQuerySchema'), schemaName: 'browseVacanciesQuerySchema', schemaIn: 'query', response: '`{ items[], total, limit, offset }`' },
      { method: 'POST', path: '/api/vacancies/:id/interest', auth: 'tutor', purpose: 'Express interest in a single action, with no cover letter (FR-13.4).', schema: s(organisationSchemas, 'expressInterestSchema'), schemaName: 'expressInterestSchema', response: '`{ interest, alreadyExpressed }`', errors: ['403 `tutor_not_verified`', '404 `tutor_profile_missing`', '409 `vacancy_closed`'], note: 'The body is ignored entirely — there is no cover letter to send. Repeating the action returns **200** and the existing row rather than a conflict: the intent was expressed either way. You must have cleared identity verification, because verification gates every path that reaches a person, not only search.' },
      { method: 'GET', path: '/api/vacancies/interests/mine', auth: 'tutor', purpose: 'What you have answered.', response: '`{ items[], count }`' },
    ],
  },
  {
    title: 'AI components',
    spec: '§6.10, §6.11, §6.22, §6.26',
    blurb:
      'The model classifies, narrates and sequences; **application code computes, validates and enforces** (§7.2, §2.9). No response here contains a score, price, ranking, rate, date or session count invented by a model — every number a user sees comes from a deterministic function over stored structured signals. Hard constraints are applied **in code after** the tool call. Every path degrades rather than errors: an exhausted budget, an unparseable response or every provider being down hands the user the manual path with an explanation (NFR-11). Someone who has just described their child’s difficulty must never get a stack trace.',
    routes: [
      { method: 'POST', path: '/api/ai/intake', auth: 'parent/student', purpose: 'Start a diagnostic intake session (Agent 1).', schema: s(aiRequestSchemas, 'startIntakeSchema'), schemaName: 'startIntakeSchema', response: '`{ sessionId }`', note: 'Creates the session and returns its id — **nothing else**. The opening message is delivered as the first turn, which is what produces a reply. A client that expected a reply here would render an empty first answer.' },
      { method: 'POST', path: '/api/ai/intake/:sessionId/turn', auth: 'parent/student', purpose: 'One conversational turn. At most six (FR-10.6) — enforced by a counter in the loop, not by a sentence in the prompt.', schema: s(aiRequestSchemas, 'intakeTurnSchema'), schemaName: 'intakeTurnSchema', response: '`{ reply, decision, gaps[], shortlist[], degradedToManualSearch }`', note: 'The shortlist is filtered **in code** after the model responds. `shared/ai-contract.ts` gives the search tool call no gender, budget or area field, so a model cannot relax a constraint it has no way to express. A failed intake becomes an unmet-demand record carrying no requester identity (FR-24.1).' },
      { method: 'POST', path: '/api/ai/verification', auth: 'tutor', purpose: 'Start a competency verification session (Agent 2).', schema: s(aiRequestSchemas, 'startVerificationSchema'), schemaName: 'startVerificationSchema', response: '`{ sessionId, items[] }`' },
      { method: 'POST', path: '/api/ai/verification/:sessionId/answers', auth: 'tutor', purpose: 'Answer the items. At most five exchanges (FR-11.8).', schema: s(aiRequestSchemas, 'submitAnswersSchema'), schemaName: 'submitAnswersSchema', response: '`{ verdict?, reasoning, finished }`', note: 'The model grades classifications only — correct or not, reasoned or asserted, pitched for the student or for the tutor; `shared/competency.ts` computes the mark in code (FR-11.5). A claim reaches `verified` solely through `applyVerdict`, which refuses to run without the `verification_attempts` row that justifies it. There is no second writer.' },
      { method: 'POST', path: '/api/ai/study-plan', auth: 'parent/student', purpose: 'Generate a study plan over the prerequisite graph.', schema: s(aiRequestSchemas, 'generateStudyPlanSchema'), schemaName: 'generateStudyPlanSchema', response: '`{ plan }`', note: 'Prerequisite ordering is validated **in code** after generation and the plan is regenerated on violation (FR-26.2). The model emits no dates — a `weekOffset` is an ordinal, and the arithmetic is the application’s (FR-26.4).' },
      { method: 'GET', path: '/api/ai/study-plans', auth: 'parent/student', purpose: 'Plans already generated for one student — `?studentProfileId=`.', response: '`{ items: [{ id, diagnosticId, targetDate, steps[], summary, prereqValidated, createdAt }] }`', errors: ['400 `validation_failed`', '404 `not_found`'], note: 'A read, not a generation. The §6.25 countdown and the §6.26 timeline both display a plan that already exists, and regenerating one to show it would spend a model call on a page load (§7.4). `prereqValidated` is carried through because a plan that merely looks ordered and one that was checked against the graph are different things. Another family’s profile returns **404**, identical to one that does not exist — 403 would confirm the id names a real child. A tutor is stopped earlier, by the role guard, with 403: she has no business on this endpoint at all and that is a statement about her role, not about any child.' },
      { method: 'GET', path: '/api/ai/narration/:tutorId/:topicId', auth: 'any authenticated', purpose: 'Narrated ranking breakdown (§6.22).', response: '`{ narration, breakdown }`', note: 'Cached on `score_hash`. A narration that introduces a figure absent from the breakdown, or a prohibited badge word, is **discarded** and the raw breakdown is shown instead (FR-22.4).' },
      { method: 'GET', path: '/api/ai/budget', auth: 'admin', purpose: 'Daily call budget and usage (§7.4).', response: '`{ used, limit, remaining, degraded }`', note: '`ai_call_log` records tokens, latency, cache hits and failovers — but never a prompt and never a response.' },
    ],
  },
  {
    title: 'Platform feedback and volunteers',
    spec: '§6.32, §6.33',
    blurb:
      'Both public forms take their attachment as **bytes in the body** rather than through a signed upload ticket, precisely so the content can be checked: declared type, extension and leading bytes must all agree (SEC-24). A rejection names the declared type and never the detected one — a public form that told you what it found is a free file-type oracle. The row is written **before** the mail and the dispatch outcome is written against the row: EmailJS is a notification channel, not a system of record (FR-32.9, FR-33.9, §2.13).',
    routes: [
      { method: 'POST', path: '/api/feedback', auth: 'anonymous', purpose: 'Report a bug, difficulty, wrong AI output or feature request (FR-32.6).', schema: s(feedbackSchemas, 'submitFeedbackSchema'), schemaName: 'submitFeedbackSchema', response: '`{ id, mailDispatchStatus }`', errors: ['400 `validation_failed`', '415 `unsupported_file_type`'], note: 'Never displayed publicly, never attributed to its reporter in any tutor-facing communication, never a ranking input (SEC-26). An anonymous submission carries no identity field at all — rate limiting is the abuse control, not identification.' },
      { method: 'GET', path: '/api/feedback/queue', auth: 'admin', purpose: 'The triage queue (FR-32.7).', schema: s(feedbackSchemas, 'feedbackQueueQuerySchema'), schemaName: 'feedbackQueueQuerySchema', schemaIn: 'query', response: '`{ items[] }`', note: 'Safety concerns jump the queue and are stripped of the reporter before a tutor could see them (FR-32.8, SEC-26).' },
      { method: 'GET', path: '/api/feedback/:id', auth: 'admin', purpose: 'One feedback record.', response: '`{ feedback }`', errors: ['404 `not_found`'] },
      { method: 'POST', path: '/api/feedback/:id/triage', auth: 'admin', purpose: 'Record a disposition. Audited.', schema: s(feedbackSchemas, 'triageFeedbackSchema'), schemaName: 'triageFeedbackSchema', response: '`{ feedback }`' },
      { method: 'POST', path: '/api/volunteers', auth: 'anonymous', purpose: 'Apply to tutor as a volunteer. No account required (FR-33.1).', schema: s(volunteerSchemas, 'submitVolunteerApplicationSchema'), schemaName: 'submitVolunteerApplicationSchema', response: '`{ id, mailDispatchStatus }`', errors: ['400 `validation_failed`', '415 `unsupported_file_type`'], note: 'A PDF attachment is validated by extension **and** magic bytes. A dispatch reports the **worst** outcome across its messages: the team being notified while your acknowledgement failed is not a success — you are the person waiting.' },
      { method: 'GET', path: '/api/volunteers', auth: 'admin', purpose: 'Applications by status.', response: '`{ items[] }`' },
      { method: 'GET', path: '/api/volunteers/:id', auth: 'admin', purpose: 'One application, with a short-lived signed URL for its attachment if it has one (SEC-24).', response: '`{ application, documentUrl? }`', errors: ['404 `not_found`'] },
      { method: 'POST', path: '/api/volunteers/:id/review', auth: 'admin', purpose: 'Record a review decision.', schema: s(volunteerSchemas, 'reviewVolunteerSchema'), schemaName: 'reviewVolunteerSchema', response: '`{ application }`' },
      { method: 'POST', path: '/api/volunteers/:id/approve', auth: 'admin', purpose: 'Convert to a draft tutor account.', schema: s(volunteerSchemas, 'approveVolunteerSchema'), schemaName: 'approveVolunteerSchema', response: '`{ application, tutorUserId }`', note: 'The new account is a **draft** and must clear §6.6 verification before it is searchable. A volunteer is verified on exactly the same basis as a paid tutor; the flag never substitutes for verification (FR-33.10).' },
    ],
  },
  {
    title: 'Moderation and administration',
    spec: '§6.14, §6.6, §6.28',
    blurb:
      'Every administrator decision that affects a person writes an append-only audit entry carrying actor, action, target, timestamp and reasoning (FR-14.4, NFR-19, SEC-13). **`admin_actions` is never updated or deleted** — a mistake is corrected by appending a corrective entry, and the guarded database handle throws if anything tries otherwise (§2.7). Verification is platform-owned: only an administrator can approve a tutor, only against a CNIC and academic documents, and the record states **which artefacts were checked** (§2.5).',
    routes: [
      { method: 'POST', path: '/api/flags', auth: 'any authenticated', purpose: 'Report a profile, review, vacancy, booking or user (FR-14.1, SEC-10).', schema: s(moderationSchemas, 'createFlagSchema'), schemaName: 'createFlagSchema', response: '`{ flag }`', errors: ['400 `validation_failed`'], note: 'There is no `message` target: §4.2 puts in-app chat permanently out of scope and §2.3 forbids any private tutor-to-minor channel, so no message entity exists to flag. `user` and `booking` are what make SEC-10’s "requesting families as well as tutors" true rather than half true.' },
      { method: 'GET', path: '/api/admin/dashboard', auth: 'admin', purpose: 'Live counts for every queue FR-14.3 names.', response: '`{ counts }` — see the appendix', note: 'Counts only. No row, no id and no name crosses this boundary, which is what lets an administrator-only screen read the unapproved-profile table without becoming a second listing surface that skipped the gender filter and the searchable-status gate.' },
      { method: 'GET', path: '/api/admin/flags', auth: 'admin', purpose: 'The open flag queue, oldest first (FR-14.2).', response: '`{ items[], count }`', note: 'Oldest first: a report that has waited longest is the one most likely to be about something still happening.' },
      { method: 'GET', path: '/api/admin/flags/:targetType/:targetId', auth: 'admin', purpose: 'Report history for one target — "has this happened before?"', response: '`{ items[], count }`', errors: ['400 `validation_failed`'], note: 'Administrators only. The reporter’s identity is never shown to the target of the report: a family that reports a tutor and then finds the tutor knows who reported will not report again.' },
      { method: 'POST', path: '/api/admin/flags/:id/resolve', auth: 'admin', purpose: 'Resolve with a written reason. Audited.', schema: s(moderationSchemas, 'resolveFlagSchema'), schemaName: 'resolveFlagSchema', response: '`{ flag }`', errors: ['404 `not_found`', '409 `flag_already_resolved`'], note: 'A resolution needs words — fifteen characters minimum. An audit trail of the word "dismissed" is a log, not a record. A flag resolves once: re-resolving would append an entry describing a transition that did not happen.' },
      { method: 'GET', path: '/api/admin/organisations', auth: 'admin', purpose: 'Organisations awaiting approval (FR-6.11).', response: '`{ items[], count }`' },
      { method: 'POST', path: '/api/admin/organisations/:id/decision', auth: 'admin', purpose: 'Approve or reject with a written reason. Audited.', schema: s(organisationSchemas, 'decideOrgApprovalSchema'), schemaName: 'decideOrgApprovalSchema', response: '`{ organisation }`' },
      { method: 'GET', path: '/api/admin/verifications', auth: 'admin', purpose: 'The tutor verification queue, stably sorted (FR-6.4).', response: '`{ items[], total }`', note: 'Filterable to profiles carrying an open duplicate-CNIC flag, so the queue can be narrowed to the ones that most need a person (FR-28.7).' },
      { method: 'GET', path: '/api/admin/verifications/:tutorId', auth: 'admin', purpose: 'One tutor’s submission and decision history.', response: '`{ profile, documents[], records[] }`' },
      { method: 'POST', path: '/api/admin/verifications/:tutorId/documents/:documentId/view', auth: 'admin', purpose: 'Issue a short-lived signed URL for a verification document.', response: '`{ url, expiresInSeconds, docType }`', note: 'A POST rather than a GET because it **writes**: every access is logged before the URL is issued (SEC-7, NFR-9).' },
      { method: 'POST', path: '/api/admin/verifications/:tutorId/approve', auth: 'admin', purpose: 'Approve identity against itemised artefacts.', response: '`{ record }`', note: 'The record names the artefacts checked — CNIC, academic document, or both — and the public badge is generated from that list, so "verified" can never mean more on the profile than the administrator actually looked at. Badge wording never implies a police or background check, because none is performed (FR-6.5, FR-6.8, SEC-6).' },
      { method: 'POST', path: '/api/admin/verifications/:tutorId/reject', auth: 'admin', purpose: 'Reject with a written reason. Appealable (SEC-18).', response: '`{ record }`', note: 'One row per decision, ever. A later decision supersedes an earlier one by pointing at it; the earlier row stays exactly as written.' },
      { method: 'POST', path: '/api/admin/verifications/:tutorId/request-info', auth: 'admin', purpose: 'Ask for more information.', response: '`{ record }`', note: 'A decision, not a non-decision: written, reasoned and audited like the other two, because from the tutor’s side it is an outcome that leaves them unable to work.' },
      { method: 'GET', path: '/api/admin/verifications/appeals/open', auth: 'admin', purpose: 'Open appeals, oldest first (FR-28.6).', response: '`{ items[] }`' },
      { method: 'POST', path: '/api/admin/verifications/appeals/:appealId/decide', auth: 'admin', purpose: 'Human override of a verdict (FR-28.6, decision 12).', response: '`{ appeal }`', note: 'The prior attempt is retained and never overwritten (FR-28.4).' },
    ],
  },
];
