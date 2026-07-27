# API Reference

> **Generated file — do not edit by hand.** Produced by `scripts/generate-api-docs.ts`.
> Regenerate with `npm run docs:api`; `npm run docs:api -- --check` fails if it is stale.

Every request shape below is read out of the Zod schema in `/shared` that validates it, field by field, at generation time — types, optionality, bounds and enum members included. Those schemas are used on both sides of the wire, so they cannot drift from the API they describe.

**Response shapes are described rather than generated.** Handlers build them inline and there is no response schema to introspect, so those columns are maintained by hand and may lag. Request shapes, error codes and auth requirements are the parts to trust.

## Conventions

**Authentication.** A short-lived JWT access token (15 min) in an httpOnly, `sameSite=lax`, `secure`-in-production cookie, plus a rotating opaque refresh token (7 days) scoped to `/api/auth`. **The cookie is the only accepted carrier** — there is deliberately no `Authorization` header path, and no token appears in a URL, a log line or `localStorage` (§2.11). Revocation takes effect within one access-token lifetime; that bound is stated rather than hidden.

**Errors.** Every failure is `{ "error": { "code", "message" } }`. `message` is written for a person and is safe to display. Unexpected failures return a bare `500 internal_error` and never echo the submitted payload — an error can carry a query fragment, a file path or a value from a row, and none of those belong in a response.

**Ownership.** A resource that does not exist and one belonging to somebody else both return **404**, never 403. Returning different codes would turn the endpoint into an existence oracle: a parent could enumerate other families' booking ids by watching which status came back.

**Money is integer paisa.** 1 PKR = 100 paisa, everywhere, with no exceptions — never a float, never a decimal string (§2.1). `2_500_000` is PKR 25,000.

**Text is stored unchanged.** User-generated text may be Urdu script, Roman Urdu, English or a mix within one sentence. It is stored byte for byte and **never machine-translated** (§2.10). No endpoint validates user text against a Latin-only character class.

**Rate limiting.** A general limiter applies to every route; the authentication and public-form routes carry tighter ones. Exceeding it returns `429 rate_limited`.

## Contents

- [Health and demonstration](#health-and-demonstration) — §6.15, 4 routes
- [Authentication](#authentication) — §6.1, 5 routes
- [Reference data](#reference-data) — §6.2, §6.3, 10 routes
- [Search and discovery](#search-and-discovery) — §6.7, §6.16, 1 routes
- [Tutor profile and onboarding](#tutor-profile-and-onboarding) — §6.4, §6.5, §6.29, 25 routes
- [Booking](#booking) — §6.8, §6.20, §6.30, 9 routes
- [Student profiles](#student-profiles) — §6.2, SEC-1, 4 routes
- [Progress ledger](#progress-ledger) — §6.12, 1 routes
- [Reviews](#reviews) — §6.9, 4 routes
- [Payments — records only](#payments--records-only) — §6.31, 8 routes
- [Group tuition](#group-tuition) — §6.23, 9 routes
- [Unmet demand board](#unmet-demand-board) — §6.24, 2 routes
- [Organisations and vacancies](#organisations-and-vacancies) — §6.13, 10 routes
- [AI components](#ai-components) — §6.10, §6.11, §6.22, §6.26, 8 routes
- [Platform feedback and volunteers](#platform-feedback-and-volunteers) — §6.32, §6.33, 9 routes
- [Moderation and administration](#moderation-and-administration) — §6.14, §6.6, §6.28, 15 routes

## Health and demonstration

*Specification §6.15.*

Anonymous by requirement (FR-15.1). The demonstration routes reach no AI provider and need no API key — they read stored sessions, so a rate limit reached during assessment cannot take the demonstration down (FR-15.7, §15 risk table).

#### `GET /api/health`

Liveness, version, and whether address encryption is configured.

**Auth:** anonymous

**Response:** `{ status, version, addressEncryption }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Address encryption is reported because an address cannot be stored or read without it, and discovering that after a family has typed one in is too late.

#### `GET /api/demo/scenarios`

The five "See it work" scenarios (FR-15.1).

**Auth:** anonymous

**Response:** `{ items[], count, replay: { liveModelCalls: 0, note } }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/demo/scenarios/:key`

One scenario: transcript, provenance and exhibit.

**Auth:** anonymous

**Response:** `{ scenario, replay }`

**Errors:** 404 `not_found`

#### `GET /api/demo/scenarios/:key/turns/:index`

One turn of a stored session. 0-based and idempotent.

**Auth:** anonymous

**Response:** `{ scenarioKey, index, turn, hasNext, totalTurns, liveModelCalls: 0 }`

**Errors:** 400 `validation_failed`, 404 `not_found`

> The turn number is a path parameter rather than stored progress, so two people demonstrating at once cannot share a cursor and step on each other.

## Authentication

*Specification §6.1.*

Short-lived JWT access cookie (15 min) plus a rotating opaque refresh token (7 days) scoped to `/api/auth`. **The httpOnly cookie is the only accepted carrier** — there is deliberately no `Authorization` header path and no token in any URL, log line or `localStorage` (§2.11). `admin` is absent from the registerable roles by construction (FR-1.5), and no role for a minor exists (§2.3).

#### `POST /api/auth/register`

Create a parent, student, tutor or organisation account.

**Auth:** anonymous

**Request body** — `registerSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | yes | email, max length 254 |
| `password` | string | yes | min length 10, max length 200 |
| `role` | `parent` \| `student` \| `tutor` \| `organisation` | yes | — |
| `displayName` | string | yes | min length 2, max length 120 |
| `phone` | string | no | — |
| `gender` | `female` \| `male` \| `other` | no | — |
| `preferredLang` | `en` \| `ur` | no | default `en` |
| `dateOfBirth` | string | no | — |

**Response:** `{ user }` and both session cookies

**Errors:** 400 `validation_failed`, 409 `email_taken`

> Registering as `student` means an **adult** student and requires a date of birth, checked in the schema and again in the service against an injected clock.

#### `POST /api/auth/login`

Exchange credentials for a session.

**Auth:** anonymous

**Request body** — `loginSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `email` | string | yes | email, max length 254 |
| `password` | string | yes | min length 1, max length 200 |

**Response:** `{ user }` and both session cookies

**Errors:** 400 `validation_failed`, 401 `invalid_credentials`

> An unknown email, a wrong password and a malformed email all return the identical response — the endpoint is not an account-existence oracle.

#### `POST /api/auth/refresh`

Rotate the refresh token and reissue the access cookie.

**Auth:** anonymous

**Response:** both cookies reissued

**Errors:** 401 `refresh_invalid`

> Presenting an already-rotated token revokes the whole family and bumps `tokenVersion`: the server cannot distinguish a confused client from a stolen token, so it assumes the worse.

#### `POST /api/auth/logout`

Clear both cookies. Idempotent.

**Auth:** anonymous

**Response:** `{ ok: true }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/auth/me`

The current account.

**Auth:** any authenticated

**Response:** `{ user }`

**Errors:** 401 `authentication_required`

> Never returns a password hash or the token version.

## Reference data

*Specification §6.2, §6.3.*

**Anonymous and heavily cached.** These taxonomies are the only genuinely static data in the system: seeded from committed files, containing no user information, changing only when somebody edits a seed and redeploys (§12). They carry a one-hour browser cache and a one-day shared cache, and the client fetches each list once per session — a picker that refetched the area list on every keystroke would spend a metered connection on data that cannot have changed.

**There is no map, no pin and no coordinate in any of these responses.** Area is the finest granularity in this product (§4.2), and "neighbouring areas" is a hand-curated adjacency list rather than a distance calculation — which is the better answer in a city where two kilometres can be forty minutes.

Names come back bilingual. `nameUr` is **nullable**: many Pakistani place names are habitually written in Latin even in Urdu text ("DHA", "F-10", "PECHS"), and inventing an Urdu spelling nobody uses would be worse than showing the familiar one. A null means "render `name` as it stands".

#### `GET /api/reference/provinces`

All seven provinces and territories (FR-2.2).

**Auth:** anonymous

**Response:** `{ items: [{ id, name, nameUr, code }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/reference/cities`

Cities, optionally filtered by `?provinceId=`.

**Auth:** anonymous

**Response:** `{ items: [{ id, provinceId, name, nameUr }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/reference/areas`

Areas, optionally filtered by `?cityId=`.

**Auth:** anonymous

**Response:** `{ items: [{ id, cityId, name, nameUr }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Area is where location stops. There is no finer granularity in this system and no endpoint that returns one.

#### `GET /api/reference/areas/adjacent`

Areas neighbouring the given ones — `?ids=a,b` (FR-2.7).

**Auth:** anonymous

**Response:** `{ items: [areaId] }`

**Errors:** 400 `validation_failed`

> A curated adjacency list, not a radius. The seed areas are excluded from the result: a caller asking what is next to Clifton does not mean Clifton.

#### `GET /api/reference/subjects`

All subjects.

**Auth:** anonymous

**Response:** `{ items: [{ id, name, nameUr }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/reference/levels`

All levels, in curriculum order.

**Auth:** anonymous

**Response:** `{ items: [{ id, name, sortOrder }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Sorted by `sortOrder`, not alphabetically — Matric comes after Middle and before Intermediate, which no alphabet agrees with.

#### `GET /api/reference/boards`

All examination boards.

**Auth:** anonymous

**Response:** `{ items: [{ id, name, nameUr }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/reference/topics`

Topics for one curriculum triple — `?subjectId=&levelId=&boardId=`.

**Auth:** anonymous

**Response:** `{ items: [{ id, subjectId, levelId, boardId, name, nameUr, chapterRef, sortOrder }] }`

**Errors:** 400 `validation_failed`

> **All three parameters are required.** Board is part of the curriculum, not a detail of it (decision 5): topics for a subject and level alone would be wrong for whichever board the family actually sits.

#### `GET /api/reference/topics/prerequisites`

The prerequisite graph reachable from `?ids=a,b` (§2.4, FR-3.4).

**Auth:** anonymous

**Response:** `{ edges: [{ topicId, prerequisiteTopicId }], topics: [...] }`

**Errors:** 400 `validation_failed`

> Returns **edges**, not a tree. The §2.4 chain — quadratic equations depends on algebraic factorisation, which depends on signed-number arithmetic — is a path through a graph, and flattening it here would throw away the shape the client needs to draw. Walked breadth-first in code rather than by a recursive CTE, which would be the one query in this codebase that behaves differently on the two dialects.

#### `GET /api/reference/service-types`

Service categories (FR-3.7).

**Auth:** anonymous

**Response:** `{ items: [{ id, name, nameUr }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

## Search and discovery

*Specification §6.7, §6.16.*

**Anonymous — browsing and search require no login (FR-1.6).** Gender preference is a hard SQL exclusion applied before ranking: a non-conforming tutor is *absent from the result set*, never ranked lower and never merely greyed out (§2.4, FR-16.3). The search path performs no aggregate computation and makes no AI call; it is indexed SQL against materialised columns and returns in under 500 ms against a 500-tutor dataset (NFR-1 — measured worst p95, 30.44 ms).

#### `GET /api/search`

Find tutors. Only identity-verified, approved profiles are searchable (FR-6.3).

**Auth:** anonymous

**Query** — `searchQuerySchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | no | min length 1 |
| `levelId` | string | no | min length 1 |
| `boardId` | string | no | min length 1 |
| `topicIds` | string[] | yes | max 20 items, min length 1, coerced from string |
| `cityId` | string | no | min length 1 |
| `areaId` | string | no | min length 1 |
| `includeAdjacentAreas` | boolean | no | default `false` |
| `mode` | `home` \| `online` \| `own_place` | no | — |
| `engagementType` | `monthly` \| `short_term_package` \| `single_session` \| `group` | no | — |
| `genderPreference` | `female_only` \| `male_only` \| `no_preference` | no | default `no_preference` |
| `maxHourlyRate` | integer | no | min 0 |
| `verifiedOnly` | boolean | no | default `false` |
| `volunteerOnly` | boolean | no | default `false` |
| `availableWeekday` | integer | no | min 0, max 6 |
| `availableFrom` | string | no | — |
| `availableTo` | string | no | — |
| `sort` | `relevance` \| `rate_asc` \| `rate_desc` \| `reviews` \| `response_time` | no | default `relevance` |
| `limit` | integer | no | default `20`, min 1, max 50 |
| `offset` | integer | no | default `0`, min 0, max 1000 |

**Response:** `{ results[], total }`, each result carrying its deterministic score breakdown

**Errors:** 400 `validation_failed`

> The default is `no_preference` — the system never pre-sets the gender filter on a caller’s behalf (FR-16.6).

## Tutor profile and onboarding

*Specification §6.4, §6.5, §6.29.*

One anonymous read — `GET /api/tutors/public/:slug`, the profile a family sees — and the rest owner-scoped: they serve the tutor’s own view of their own profile, whatever its status. **No tutor-facing endpoint may write `approved`** — a tutor moves `draft → pending_verification` by submitting, and every transition after that belongs to an administrator (§2.5). A claim is an assertion until something tests it, so `claimStatus` is only ever `asserted` here.

#### `GET /api/tutors/public/:slug`

The public profile a family reads — §6.4, §6.17, §6.21, §6.22.

**Auth:** anonymous

**Response:** `{ tutor, rates[], claims[], availability[], reliability, normalisedHourly, benchmarkMedian, verification }`

**Errors:** 404 `not_found`

> The one anonymous route in this section (FR-1.6). It resolves the slug through the **searchable predicate**, so an unapproved tutor is not found at all (FR-6.3) — and an unknown slug and an unapproved tutor return the identical 404, because a distinguishable one would tell a stranger that a named person had applied and been turned down. Carries no CNIC, no document path, no email, no street address and no `verifiedScore`: the FR-11.5 rubric figure behind a competency verdict is internal. `reliability` and `benchmarkMedian` are read from tables a job materialised (§2.8); a null benchmark is the SEC-17 cohort suppression working, not missing data.

#### `GET /api/tutors/profile`

Your own profile.

**Auth:** tutor

**Response:** `{ profile }`

**Errors:** 404 `not_found`

#### `POST /api/tutors/profile`

Create the profile. Slug collisions are resolved server-side.

**Auth:** tutor

**Request body** — `tutorProfileCreateSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `gender` | `female` \| `male` | yes | — |
| `cityId` | string | yes | min length 1 |
| `bio` | string | no | max length 4000 |
| `bioUr` | string | no | max length 4000 |
| `qualifications` | string | no | max length 2000 |
| `experienceYears` | integer | no | default `0`, min 0, max 60 |
| `teachesAtHome` | boolean | no | default `false` |
| `teachesOnline` | boolean | no | default `false` |
| `teachesAtOwnPlace` | boolean | no | default `false` |
| `willingAreaIds` | string[] | no | max 60 items, min length 1 |
| `volunteer` | boolean | no | default `false` |

**Response:** `{ profile }`

**Errors:** 409 `profile_exists`

#### `PATCH /api/tutors/profile`

Edit the profile.

**Auth:** tutor

**Request body** — `tutorProfileUpdateSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `gender` | `female` \| `male` | no | — |
| `cityId` | string | no | min length 1 |
| `bio` | string | no | max length 4000 |
| `bioUr` | string | no | max length 4000 |
| `qualifications` | string | no | max length 2000 |
| `experienceYears` | integer | no | default `0`, min 0, max 60 |
| `teachesAtHome` | boolean | no | default `false` |
| `teachesOnline` | boolean | no | default `false` |
| `teachesAtOwnPlace` | boolean | no | default `false` |
| `willingAreaIds` | string[] | no | max 60 items, min length 1 |
| `volunteer` | boolean | no | default `false` |

**Response:** `{ profile }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/profile/submit`

Submit for verification (`draft → pending_verification`).

**Auth:** tutor

**Response:** `{ profile }`

**Errors:** 409 `incomplete_profile`

#### `GET /api/tutors/claims`

Your subject claims.

**Auth:** tutor

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/claims`

Claim a subject, level and board with topics. Board is part of the claim, not a detail of it (decision 5).

**Auth:** tutor

**Request body** — `subjectClaimSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | yes | min length 1 |
| `levelId` | string | yes | min length 1 |
| `boardId` | string | yes | min length 1 |
| `topicIds` | string[] | yes | min 1 items, max 80 items, min length 1 |

**Response:** `{ claim }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `PATCH /api/tutors/claims/:id`

Edit a claim.

**Auth:** tutor

**Request body** — `subjectClaimSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | yes | min length 1 |
| `levelId` | string | yes | min length 1 |
| `boardId` | string | yes | min length 1 |
| `topicIds` | string[] | yes | min 1 items, max 80 items, min length 1 |

**Response:** `{ claim }`

**Errors:** 404 `not_found`

#### `DELETE /api/tutors/claims/:id`

Withdraw a claim.

**Auth:** tutor

**Response:** `204`

**Errors:** 404 `not_found`

#### `GET /api/tutors/rates`

Your rate table.

**Auth:** tutor

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/rates`

Add a rate. **Integer paisa** — 1 PKR = 100 paisa (§2.1).

**Auth:** tutor

**Request body** — `tutorRateSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | no | nullable, min length 1 |
| `levelId` | string | no | nullable, min length 1 |
| `rateType` | `monthly` \| `hourly` \| `single_session` \| `group_monthly` | yes | — |
| `amount` | integer | yes | min 0 |
| `sessionsPerWeek` | integer | no | nullable, min 1, max 7 |
| `minutesPerSession` | integer | no | nullable, min 15, max 480 |
| `mode` | `home` \| `online` \| `own_place` | yes | — |
| `groupSizeMax` | integer | no | nullable, min 2, max 12 |
| `perHeadAmount` | integer | no | nullable, min 0 |
| `negotiable` | boolean | no | default `false` |
| `travelCharge` | integer | no | default `0`, min 0 |

**Response:** `{ rate }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Every rate is normalised to a comparable hourly figure by `shared/rates.ts` on write. That single converter is what makes benchmarking possible across four different pricing shapes.

#### `PUT /api/tutors/rates/:id`

Replace a rate.

**Auth:** tutor

**Request body** — `tutorRateSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | no | nullable, min length 1 |
| `levelId` | string | no | nullable, min length 1 |
| `rateType` | `monthly` \| `hourly` \| `single_session` \| `group_monthly` | yes | — |
| `amount` | integer | yes | min 0 |
| `sessionsPerWeek` | integer | no | nullable, min 1, max 7 |
| `minutesPerSession` | integer | no | nullable, min 15, max 480 |
| `mode` | `home` \| `online` \| `own_place` | yes | — |
| `groupSizeMax` | integer | no | nullable, min 2, max 12 |
| `perHeadAmount` | integer | no | nullable, min 0 |
| `negotiable` | boolean | no | default `false` |
| `travelCharge` | integer | no | default `0`, min 0 |

**Response:** `{ rate }`

**Errors:** 404 `not_found`

#### `DELETE /api/tutors/rates/:id`

Remove a rate.

**Auth:** tutor

**Response:** `204`

**Errors:** 404 `not_found`

#### `GET /api/tutors/availability`

Your weekly availability template.

**Auth:** tutor

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/availability`

Add an availability window.

**Auth:** tutor

**Request body** — `availabilitySlotSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `weekday` | integer | yes | min 0, max 6 |
| `startTime` | string | yes | — |
| `endTime` | string | yes | — |
| `mode` | `home` \| `online` \| `own_place` | yes | — |
| `areaId` | string | no | nullable, min length 1 |

**Response:** `{ slot }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `DELETE /api/tutors/availability/:id`

Remove an availability window.

**Auth:** tutor

**Response:** `204`

**Errors:** 404 `not_found`

#### `GET /api/tutors/safety`

Your declared safety constraints.

**Auth:** tutor

**Response:** `{ constraints }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `PUT /api/tutors/safety`

Student-gender restriction, guardian-presence requirement, area restrictions.

**Auth:** tutor

**Request body** — `safetyConstraintsSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `femaleStudentsOnly` | boolean | no | default `false` |
| `guardianPresenceRequired` | boolean | no | default `false` |
| `restrictedAreaIds` | string[] | no | max 200 items, min length 1 |

**Response:** `{ constraints }`

**Errors:** 400 `validation_failed` where a body or query is validated

> These are **enforced by the system at booking time**, not merely displayed (SEC-19). Declines made under a declared constraint are excluded from your confirmation-rate statistic, so holding to them costs you nothing (SEC-21).

#### `GET /api/tutors/documents`

Your uploaded verification documents — metadata only.

**Auth:** tutor

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/documents/ticket`

A short-lived signed upload URL.

**Auth:** tutor

**Request body** — `uploadTicketRequestSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `docType` | `cnic_front` \| `cnic_back` \| `degree` \| `transcript` \| `other` | yes | — |
| `fileName` | string | yes | min length 1, max length 255 |
| `mimeType` | `image/jpeg` \| `image/png` \| `application/pdf` | yes | — |
| `sizeBytes` | integer | yes | min 0, max 5242880 |

**Response:** `{ uploadUrl, storagePath, expiresInSeconds }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The browser PUTs straight to storage, so the server never holds the bytes and **cannot sniff them**. That gap is recorded under SEC-24 in `docs/SECURITY_REVIEW.md` and must not be described as closed.

#### `POST /api/tutors/documents`

Confirm an upload completed and record the document.

**Auth:** tutor

**Request body** — `confirmDocumentSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `docType` | `cnic_front` \| `cnic_back` \| `degree` \| `transcript` \| `other` | yes | — |
| `storagePath` | string | yes | min length 1, max length 400 |

**Response:** `{ document }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `DELETE /api/tutors/documents/:id`

Remove a document.

**Auth:** tutor

**Response:** `204`

**Errors:** 404 `not_found`

#### `POST /api/tutors/cnic`

Register a CNIC for duplicate detection.

**Auth:** tutor

**Response:** `{ duplicateFlagged }`

**Errors:** 400 `validation_failed` where a body or query is validated

> **The number is never stored, anywhere, in any column.** A salted SHA-256 hash supports exactly one question — has this document been used on another account — and supports no other (SEC-8, NFR-10). The hash is deliberately not unique: a collision is flagged to an administrator, because a machine cannot tell fraud from a family member re-registering after a failed signup.

#### `GET /api/tutors/verification`

Your verification history and current badges.

**Auth:** tutor

**Response:** `{ records[], badges[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/tutors/appeals`

Appeal a rejection or a failed competency verdict.

**Auth:** tutor

**Response:** `{ appeal }`

**Errors:** 409 `appeal_not_yet_eligible`, 409 `already_appealed`

> Appealable **once**, after a seven-day cooling period (FR-28.3). An automated verdict affecting a livelihood is never final without a route to human review (SEC-18, decision 12).

## Booking

*Specification §6.8, §6.20, §6.30.*

The state machine lives server-side and returns **409** on an illegal transition. A minor is never the requester — a parent is (SEC-1, SEC-2). The delivery address is captured on a confirmed booking, encrypted with AES-256-GCM, and readable only by the two parties; the tutor sees the **area** before she confirms and the **street** only after (SEC-20). `server/services/address.ts` is the only module that may decrypt one, and `BookingRecord` has no address field at all — a handler cannot leak what it never receives.

#### `GET /api/bookings/slots`

Free slots for a tutor: the availability template minus live bookings.

**Auth:** any authenticated

**Query** — `slotQuerySchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tutorId` | string | yes | min length 1 |
| `fromDate` | string | yes | — |
| `toDate` | string | yes | — |
| `slotMinutes` | integer | no | default `60`, min 30, max 240 |
| `mode` | `home` \| `online` \| `own_place` | no | — |

**Response:** `{ slots[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/bookings`

Your bookings, as family or as tutor.

**Auth:** any authenticated

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/bookings/:id`

One booking.

**Auth:** owner

**Response:** `{ booking }`

**Errors:** 404 `not_found`

#### `POST /api/bookings`

Request a booking — monthly, short-term package, single session or group.

**Auth:** parent/student

**Request body** — `createBookingSchema`, generated from the Zod schema:

_No fields — the empty object is the request._

**Response:** `{ booking }`

**Errors:** 400 `validation_failed`, 409 `slot_taken`, 409 `tutor_constraints_not_met`, 409 `volunteer_cap_reached`

> Double-booking is prevented by a unique index, not by a check-then-write. The tutor’s declared safety constraints are enforced here, at request time.

#### `POST /api/bookings/:id/transition`

Confirm, decline, start, complete, cancel or mark a no-show.

**Auth:** owner

**Request body** — `transitionBookingSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `to` | `confirmed` \| `in_progress` \| `completed` \| `cancelled` \| `declined` \| `no_show` | yes | — |
| `reason` | string | no | max length 1000 |
| `declineUnderSafetyConstraint` | boolean | no | default `false` |

**Response:** `{ booking }`

**Errors:** 404 `not_found`, 409 `illegal_transition`

#### `GET /api/bookings/:id/notes`

Session notes for this booking.

**Auth:** owner

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/bookings/:id/notes`

Record a session note: topics covered and a 1–5 mastery rating each (FR-12.1).

**Auth:** tutor

**Request body** — `sessionNoteSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `topicsCovered` | string[] | yes | min 1 items, max 40 items, min length 1 |
| `masteryRatings` | object (map) | yes | — |
| `note` | string | no | max length 4000 |

**Response:** `{ note }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/bookings/:id/fit-check`

The trial fit check, if one was submitted.

**Auth:** owner

**Response:** `{ fitCheck }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/bookings/:id/fit-check`

Submit a trial fit check.

**Auth:** parent/student

**Request body** — `trialFitCheckSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `communication` | integer | yes | min 1, max 5 |
| `punctuality` | integer | yes | min 1, max 5 |
| `engagement` | integer | yes | min 1, max 5 |
| `pace` | integer | yes | min 1, max 5 |
| `continueDecision` | boolean | yes | — |
| `note` | string | no | max length 2000 |

**Response:** `{ fitCheck }`

**Errors:** 400 `validation_failed` where a body or query is validated

> **Private to the requesting family and administrators.** Never shown to the tutor, never on a public profile, never a ranking input — that privacy is what keeps it candid (SEC-15, decision 11).

## Student profiles

*Specification §6.2, SEC-1.*

**A learner is a row here, and nowhere else.** There is no `users` row for a minor, no credential, no session, no login path and no invitation path — the absence is the enforcement (§2.3), asserted structurally by `server/child-safety.test.ts`. Ownership is decided by the **caller’s role**, never by the request body: a parent’s POST produces a parent-owned profile and an adult student’s produces a self-owned one, so “register my child as an adult” is not a request that can be expressed rather than one that is refused.

#### `GET /api/students`

Every learner this account is responsible for.

**Auth:** parent/student

**Response:** `{ items: [{ id, name, gender, levelId, boardId, schoolName, dateOfBirth, parentOwned, createdAt }] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/students`

Add a learner. Creates a profile, never an account.

**Auth:** parent/student

**Request body** — `createStudentProfileSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | string | yes | min length 1, max length 120 |
| `gender` | `female` \| `male` \| `other` | no | — |
| `levelId` | string | no | min length 1 |
| `boardId` | string | no | min length 1 |
| `schoolName` | string | no | max length 200 |
| `dateOfBirth` | string | no | — |

**Response:** `{ profile }`

**Errors:** 400 `validation_failed`, 400 `invalid_ownership`

> The schema carries no `parentUserId` or `selfUserId` field. `invalid_ownership` is what an adult student gets for entering a date of birth under 18 — a safety rule, not a validation quibble.

#### `GET /api/students/:id`

One learner, if this account owns them.

**Auth:** parent/student

**Response:** `{ profile }`

**Errors:** 404 `not_found`

> A profile that does not exist and one belonging to another family return the **identical 404** — 403 would confirm the id names a real child.

#### `PATCH /api/students/:id`

Amend a learner’s details.

**Auth:** parent/student

**Request body** — `updateStudentProfileSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `name` | string | no | min length 1, max length 120 |
| `gender` | `female` \| `male` \| `other` | no | — |
| `levelId` | string | no | min length 1 |
| `boardId` | string | no | min length 1 |
| `schoolName` | string | no | max length 200 |
| `dateOfBirth` | string | no | — |

**Response:** `{ profile }`

**Errors:** 404 `not_found`

> Ownership columns are not in the patch and cannot be reached from here — a profile never changes hands, because the two shapes that would need it are the two §2.3 forbids.

## Progress ledger

*Specification §6.12.*

Per-student mastery over time, assembled from session notes and the verification record of the tutor who wrote each one, with the original diagnostic gap map set against actual coverage (FR-12.3) and a stagnation indicator where a topic shows three or more sessions with no increase (FR-12.4).

#### `GET /api/students/:studentProfileId/progress`

The ledger. Owning parent, adult self-managing student, or an administrator.

**Auth:** owner

**Response:** `{ ledger: { entries[], topics[], gapCoverage[], stagnantTopicIds[], summary } }`

**Errors:** 404 `not_found`

> A profile that does not exist and one belonging to another family both return **404** — never 403, which would make the endpoint an existence oracle over student ids. The tutor who taught the sessions cannot read the ledger either.

## Reviews

*Specification §6.9.*

A review requires a **completed booking** and is therefore traceable to a real interaction (SEC-5). Analysis is asynchronous and never blocks the POST; a malformed model response is retried once, then the record is marked `unanalysed` and the work moves on — a bad response must never lose the user’s data. A generic review is **down-weighted, never hidden and never deleted** (FR-9.6). A rating that contradicts its own text is surfaced **publicly** (FR-9.7). A safety concern routes privately to the administrator queue and never triggers an automatic notification to the tutor (SEC-9).

#### `POST /api/reviews`

Leave one review for a completed booking.

**Auth:** parent/student

**Response:** `{ review }`

**Errors:** 400 `validation_failed`, 409 `already_reviewed`, 409 `booking_not_completed`

#### `GET /api/reviews/:id`

One review with its analysis.

**Auth:** any authenticated

**Response:** `{ review, analysis }`

**Errors:** 404 `not_found`

#### `GET /api/reviews/tutor/:tutorId`

Public reviews for a tutor.

**Auth:** anonymous

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Safety-flagged reviews are filtered out in the repository, not in the interface (SEC-9).

#### `GET /api/reviews/admin/safety-queue`

Reviews an analysis flagged as a safety concern (FR-9.8).

**Auth:** admin

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

## Payments — records only

*Specification §6.31.*

**Ustaad.com does not process or hold funds.** There is no gateway, no escrow, no payout, no commission, no wallet and no refund flow, and there never will be (§2.6). What exists is a record: the agreed rate and rate type frozen at confirmation, dual acknowledgement, and an administrator dispute path. A payment is `settled` only when **both** parties have acknowledged it; a single-party claim displays as unconfirmed (FR-31.4). Payment history contributes to neither public ranking nor public statistics (FR-31.12, SEC-22).

#### `GET /api/payments/:id`

One payment record. The two parties and administrators only.

**Auth:** owner

**Response:** `{ record }`

**Errors:** 404 `not_found`

#### `GET /api/payments/bookings/:bookingId`

Every record for one engagement — the per-engagement statement (FR-31.8).

**Auth:** owner

**Response:** `{ items[], totals }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `PATCH /api/payments/:id`

Amend a record before both parties have confirmed.

**Auth:** owner

**Response:** `{ record }`

**Errors:** 409 `agreed_amount_immutable`

> `agreedAmount` becomes immutable once both parties have acknowledged, and the endpoint returns 409 rather than silently ignoring the change.

#### `POST /api/payments/:id/mark-paid`

The family records that it has paid.

**Auth:** parent/student

**Response:** `{ record }`

**Errors:** 400 `validation_failed` where a body or query is validated

> On its own this is a claim, not a settlement — it displays as unconfirmed until the tutor agrees.

#### `POST /api/payments/:id/confirm-received`

The tutor confirms receipt. This is what settles it.

**Auth:** tutor

**Response:** `{ record }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/payments/:id/disputes`

Raise a dispute.

**Auth:** owner

**Response:** `{ dispute }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/payments/admin/disputes`

Open and under-review disputes.

**Auth:** admin

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/payments/admin/disputes/:disputeId/resolve`

Resolve with written reasoning. Audited (FR-31.7).

**Auth:** admin

**Response:** `{ dispute }`

**Errors:** 400 `validation_failed` where a body or query is validated

## Group tuition

*Specification §6.23.*

**Opt-in only** — nothing outside `createGroupRequest` writes a `group_requests` row. Pooling is a pure deterministic function with no database, no clock, no randomness and no AI (FR-23.7, decision 10), so a family can be told exactly why it was grouped with these students. Every hard constraint must agree between **every pair** of members, not merely between each member and the seed. A group carries the **strictest** gender requirement any member stated and never relaxes one. `group_proposals.confirmed_at` is the commit point: a set of bookings is not a group until that column is set (§2.12).

#### `POST /api/groups/requests`

Opt in to group matching.

**Auth:** parent/student

**Request body** — `createGroupRequestSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `studentProfileId` | string | yes | min length 1 |
| `subjectId` | string | yes | min length 1 |
| `levelId` | string | yes | min length 1 |
| `boardId` | string | yes | min length 1 |
| `topicIds` | string[] | yes | min 1 items, max 20 items, min length 1 |
| `areaId` | string | yes | min length 1 |
| `areaFlex` | boolean | no | default `false` |
| `genderPreference` | `female_only` \| `male_only` \| `no_preference` | no | default `no_preference` |
| `maxGroupSize` | integer | yes | min 2, max 6 |
| `budgetMax` | integer | no | nullable, min 0 |
| `availability` | object { weekday, startTime, endTime }[] | yes | min 1 items, max 21 items |

**Response:** `{ request }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/groups/requests`

Your own group requests.

**Auth:** parent/student

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `DELETE /api/groups/requests/:id`

Withdraw a request.

**Auth:** parent/student

**Response:** `204`

**Errors:** 404 `not_found`

#### `GET /api/groups/requests/:id/matches`

Candidate groups from the solver, with a per-member explanation.

**Auth:** parent/student

**Response:** `{ candidates[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

> An explanation names no other family — counts and constraints only (FR-23.8).

#### `POST /api/groups/proposals`

Propose a group to a tutor.

**Auth:** parent/student

**Request body** — `proposeGroupSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `tutorId` | string | yes | min length 1 |
| `memberRequestIds` | string[] | yes | min 2 items, max 6 items, min length 1 |

**Response:** `{ proposal }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The group is **re-derived from the solver** before it is proposed, never trusted from the request body — otherwise a caller could assemble a group the constraints forbid simply by not asking.

#### `GET /api/groups/proposals`

Proposals awaiting your response.

**Auth:** tutor

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/groups/proposals/:id`

One proposal with per-member explanations.

**Auth:** any authenticated

**Response:** `{ proposal, members[] }`

**Errors:** 404 `proposal_not_found`

> Member identities are limited to **first name and area** until the group confirms (SEC-14).

#### `POST /api/groups/proposals/:id/respond`

Confirm or decline your place.

**Auth:** parent/student

**Response:** `{ proposal }`

**Errors:** 400 `validation_failed` where a body or query is validated

> A family pooled into a stricter group is told so in its explanation, before it confirms.

#### `POST /api/groups/proposals/:id/tutor-response`

Accept or decline the group, at your own group rate.

**Auth:** tutor

**Response:** `{ proposal }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The group’s gender requirement is enforced against you in code — the same hard exclusion search applies (§2.4, §2.12).

## Unmet demand board

*Specification §6.24.*

Records carry **no requester identity** and cohorts below three are suppressed (SEC-16). `DEMAND_WINDOW_DAYS` is a fixed constant and must stay one: a board you can query at 29 days and again at 30 hands the caller the records in between, and a threshold of three protects nothing against someone who can subtract. No response carries a timestamp, an ordering by recency, or a caller-chosen window, and every field a caller may filter on is already part of the cohort key — so a filter selects whole cohorts and can never slice one.

#### `GET /api/demand`

The demand board as supply intelligence (FR-24.3). Also open to organisations as hiring intelligence (FR-13.7) and to administrators.

**Auth:** tutor

**Response:** `{ cohorts[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Note the absence of a `windowDays`, a `since`, an `until`, a `limit` and an `order`. Every one of those would let a caller vary the population between two requests and read the difference.

#### `GET /api/demand/supply-gaps`

The administrator supply-gap view, same suppression (FR-24.4).

**Auth:** admin

**Response:** `{ gaps[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

## Organisations and vacancies

*Specification §6.13.*

Trimmed by **decision 4** to search plus an interest-based vacancy board. **FR-13.5 is deliberately not built** — marking an interest shortlisted, contacted or closed is an applicant-tracking system, and no endpoint reaches those states. FR-13.2 has no route of its own on purpose: an organisation calls `GET /api/search` exactly as a parent does, so there is no second code path that could drift from the gender filter §2.4 forbids relaxing.

#### `PUT /api/organisations/me`

Create or edit the organisation profile (FR-13.1).

**Auth:** organisation

**Request body** — `upsertOrgProfileSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `orgName` | string | yes | min length 2, max length 160 |
| `orgType` | `academy` \| `school` \| `tuition_centre` \| `other` | yes | — |
| `description` | string | no | nullable, max length 4000 |
| `website` | string | no | nullable, URL, max length 300 |
| `cityId` | string | yes | min length 1 |
| `areaId` | string | no | nullable, min length 1 |
| `contactEmail` | string | no | nullable, email, max length 254 |
| `contactPhone` | string | no | nullable, min length 7, max length 30 |

**Response:** `{ organisation }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Editing never grants approval — the approval columns are not in the update set. An organisation cannot approve itself, for the same reason a tutor cannot (FR-6.11, §2.5).

#### `GET /api/organisations/me`

Your own profile, approved or not.

**Auth:** organisation

**Response:** `{ organisation }`

**Errors:** 404 `not_found`

#### `GET /api/organisations/:id`

Public organisation profile.

**Auth:** anonymous

**Response:** `{ organisation }`

**Errors:** 404 `not_found`

> An unapproved organisation reads as **404, not 403** — a 403 would confirm the account exists to someone who only guessed the id.

#### `POST /api/organisations/me/vacancies`

Post a vacancy (FR-13.3).

**Auth:** organisation

**Request body** — `createVacancySchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | yes | min length 1 |
| `levelId` | string | yes | min length 1 |
| `boardId` | string | no | nullable, min length 1 |
| `mode` | `home` \| `online` \| `own_place` | yes | — |
| `rateOffered` | integer | no | nullable, min 0, max 100000000 |
| `rateType` | `monthly` \| `hourly` \| `single_session` \| `group_monthly` | no | nullable |
| `areaId` | string | no | nullable, min length 1 |
| `description` | string | no | nullable, max length 4000 |

**Response:** `{ vacancy }`

**Errors:** 403 `org_not_approved`, 404 `org_profile_missing`

> An unapproved organisation may not post. Otherwise the approval gate buys nothing: an account could register, skip verification, and publish a vacancy that tutors answer.

#### `GET /api/organisations/me/vacancies`

Your vacancies, any status.

**Auth:** organisation

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `PATCH /api/organisations/me/vacancies/:id`

Close or reopen. Status is the only editable field.

**Auth:** organisation

**Request body** — `updateVacancyStatusSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | `open` \| `filled` \| `closed` | yes | — |

**Response:** `{ vacancy }`

**Errors:** 404 `not_found`

> Curriculum, rate and area stay as the tutors who answered read them. Rewriting a vacancy under the people who answered it is not an honest operation.

#### `GET /api/organisations/me/vacancies/:id/interests`

Who expressed interest. Read-only — there is deliberately no PATCH counterpart.

**Auth:** organisation

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/vacancies`

The public board: open vacancies from approved organisations (FR-13.6).

**Auth:** anonymous

**Query** — `browseVacanciesQuerySchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `subjectId` | string | no | min length 1 |
| `levelId` | string | no | min length 1 |
| `boardId` | string | no | min length 1 |
| `areaId` | string | no | min length 1 |
| `mode` | `home` \| `online` \| `own_place` | no | — |
| `limit` | integer | no | default `20`, min 1, max 50 |
| `offset` | integer | no | default `0`, min 0 |

**Response:** `{ items[], total, limit, offset }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/vacancies/:id/interest`

Express interest in a single action, with no cover letter (FR-13.4).

**Auth:** tutor

**Request body** — `expressInterestSchema`, generated from the Zod schema:

_No fields — the empty object is the request._

**Response:** `{ interest, alreadyExpressed }`

**Errors:** 403 `tutor_not_verified`, 404 `tutor_profile_missing`, 409 `vacancy_closed`

> The body is ignored entirely — there is no cover letter to send. Repeating the action returns **200** and the existing row rather than a conflict: the intent was expressed either way. You must have cleared identity verification, because verification gates every path that reaches a person, not only search.

#### `GET /api/vacancies/interests/mine`

What you have answered.

**Auth:** tutor

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

## AI components

*Specification §6.10, §6.11, §6.22, §6.26.*

The model classifies, narrates and sequences; **application code computes, validates and enforces** (§7.2, §2.9). No response here contains a score, price, ranking, rate, date or session count invented by a model — every number a user sees comes from a deterministic function over stored structured signals. Hard constraints are applied **in code after** the tool call. Every path degrades rather than errors: an exhausted budget, an unparseable response or every provider being down hands the user the manual path with an explanation (NFR-11). Someone who has just described their child’s difficulty must never get a stack trace.

#### `POST /api/ai/intake`

Start a diagnostic intake session (Agent 1).

**Auth:** parent/student

**Request body** — `startIntakeSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `goal` | string | yes | min length 1, max length 500 |
| `studentProfileId` | string | no | nullable, min length 1 |

**Response:** `{ sessionId }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Creates the session and returns its id — **nothing else**. The opening message is delivered as the first turn, which is what produces a reply. A client that expected a reply here would render an empty first answer.

#### `POST /api/ai/intake/:sessionId/turn`

One conversational turn. At most six (FR-10.6) — enforced by a counter in the loop, not by a sentence in the prompt.

**Auth:** parent/student

**Request body** — `intakeTurnSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `message` | string | yes | min length 1, max length 2000 |
| `subjectId` | string | no | min length 1 |
| `constraints` | object { genderPreference, cityId, areaId, maxHourlyRate } | no | — |

**Response:** `{ reply, decision, gaps[], shortlist[], degradedToManualSearch }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The shortlist is filtered **in code** after the model responds. `shared/ai-contract.ts` gives the search tool call no gender, budget or area field, so a model cannot relax a constraint it has no way to express. A failed intake becomes an unmet-demand record carrying no requester identity (FR-24.1).

#### `POST /api/ai/verification`

Start a competency verification session (Agent 2).

**Auth:** tutor

**Request body** — `startVerificationSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `claimId` | string | yes | min length 1 |
| `topicId` | string | yes | min length 1 |
| `isAppeal` | boolean | no | default `false` |

**Response:** `{ sessionId, items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/ai/verification/:sessionId/answers`

Answer the items. At most five exchanges (FR-11.8).

**Auth:** tutor

**Request body** — `submitAnswersSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `answers` | object { itemId, answer }[] | yes | min 1 items, max 4 items |

**Response:** `{ verdict?, reasoning, finished }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The model grades classifications only — correct or not, reasoned or asserted, pitched for the student or for the tutor; `shared/competency.ts` computes the mark in code (FR-11.5). A claim reaches `verified` solely through `applyVerdict`, which refuses to run without the `verification_attempts` row that justifies it. There is no second writer.

#### `POST /api/ai/study-plan`

Generate a study plan over the prerequisite graph.

**Auth:** parent/student

**Request body** — `generateStudyPlanSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `diagnosticId` | string | yes | min length 1 |
| `startDate` | string | yes | — |
| `targetDate` | string | yes | — |
| `levelId` | string | no | nullable, min length 1 |

**Response:** `{ plan }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Prerequisite ordering is validated **in code** after generation and the plan is regenerated on violation (FR-26.2). The model emits no dates — a `weekOffset` is an ordinal, and the arithmetic is the application’s (FR-26.4).

#### `GET /api/ai/study-plans`

Plans already generated for one student — `?studentProfileId=`.

**Auth:** parent/student

**Response:** `{ items: [{ id, diagnosticId, targetDate, steps[], summary, prereqValidated, createdAt }] }`

**Errors:** 400 `validation_failed`, 404 `not_found`

> A read, not a generation. The §6.25 countdown and the §6.26 timeline both display a plan that already exists, and regenerating one to show it would spend a model call on a page load (§7.4). `prereqValidated` is carried through because a plan that merely looks ordered and one that was checked against the graph are different things. Another family’s profile returns **404**, identical to one that does not exist — 403 would confirm the id names a real child. A tutor is stopped earlier, by the role guard, with 403: she has no business on this endpoint at all and that is a statement about her role, not about any child.

#### `GET /api/ai/narration/:tutorId/:topicId`

Narrated ranking breakdown (§6.22).

**Auth:** any authenticated

**Response:** `{ narration, breakdown }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Cached on `score_hash`. A narration that introduces a figure absent from the breakdown, or a prohibited badge word, is **discarded** and the raw breakdown is shown instead (FR-22.4).

#### `GET /api/ai/budget`

Daily call budget and usage (§7.4).

**Auth:** admin

**Response:** `{ used, limit, remaining, degraded }`

**Errors:** 400 `validation_failed` where a body or query is validated

> `ai_call_log` records tokens, latency, cache hits and failovers — but never a prompt and never a response.

## Platform feedback and volunteers

*Specification §6.32, §6.33.*

Both public forms take their attachment as **bytes in the body** rather than through a signed upload ticket, precisely so the content can be checked: declared type, extension and leading bytes must all agree (SEC-24). A rejection names the declared type and never the detected one — a public form that told you what it found is a free file-type oracle. The row is written **before** the mail and the dispatch outcome is written against the row: EmailJS is a notification channel, not a system of record (FR-32.9, FR-33.9, §2.13).

#### `POST /api/feedback`

Report a bug, difficulty, wrong AI output or feature request (FR-32.6).

**Auth:** anonymous

**Request body** — `submitFeedbackSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `websiteUrl` | string | no | max length 200 |
| `timeOnFormMs` | integer | no | min 0, max 86400000 |
| `category` | `defect` \| `usability` \| `incorrect_ai_output` \| `missing_feature` \| `content_or_safety` \| `other` | yes | — |
| `detail` | string | yes | min length 1, max length 5000 |
| `satisfactionRating` | integer | no | nullable, min 1, max 5 |
| `pagePath` | string | no | max length 500 |
| `locale` | `en` \| `ur` | no | — |
| `attachment` | object { fileName, mimeType, contentBase64 } | no | nullable |

**Response:** `{ id, mailDispatchStatus }`

**Errors:** 400 `validation_failed`, 415 `unsupported_file_type`

> Never displayed publicly, never attributed to its reporter in any tutor-facing communication, never a ranking input (SEC-26). An anonymous submission carries no identity field at all — rate limiting is the abuse control, not identification.

#### `GET /api/feedback/queue`

The triage queue (FR-32.7).

**Auth:** admin

**Query** — `feedbackQueueQuerySchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | `new` \| `triaged` \| `actioned` \| `declined` | no | — |
| `safetyOnly` | boolean \| `true` \| `false` | no | — |
| `limit` | integer | no | default `50`, min 1, max 100 |

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Safety concerns jump the queue and are stripped of the reporter before a tutor could see them (FR-32.8, SEC-26).

#### `GET /api/feedback/:id`

One feedback record.

**Auth:** admin

**Response:** `{ feedback }`

**Errors:** 404 `not_found`

#### `POST /api/feedback/:id/triage`

Record a disposition. Audited.

**Auth:** admin

**Request body** — `triageFeedbackSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | `triaged` \| `actioned` \| `declined` | yes | — |
| `dispositionNote` | string | yes | min length 3, max length 2000 |

**Response:** `{ feedback }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/volunteers`

Apply to tutor as a volunteer. No account required (FR-33.1).

**Auth:** anonymous

**Request body** — `submitVolunteerApplicationSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `websiteUrl` | string | no | max length 200 |
| `timeOnFormMs` | integer | no | min 0, max 86400000 |
| `fullName` | string | yes | min length 2, max length 120 |
| `email` | string | yes | email, max length 200 |
| `phone` | string | yes | min length 10, max length 20 |
| `cityId` | string | yes | min length 1 |
| `areaId` | string | yes | min length 1 |
| `subjectIds` | string[] | yes | min 1 items, max 10 items, min length 1 |
| `levelIds` | string[] | yes | min 1 items, max 10 items, min length 1 |
| `weeklyHours` | integer | yes | min 1, max 20 |
| `deliveryModes` | `home` \| `online` \| `own_place`[] | yes | min 1 items |
| `gender` | `male` \| `female` | yes | — |
| `motivation` | string | no | max length 2000 |
| `document` | object { fileName, mimeType, contentBase64 } | no | nullable |

**Response:** `{ id, mailDispatchStatus }`

**Errors:** 400 `validation_failed`, 415 `unsupported_file_type`

> A PDF attachment is validated by extension **and** magic bytes. A dispatch reports the **worst** outcome across its messages: the team being notified while your acknowledgement failed is not a success — you are the person waiting.

#### `GET /api/volunteers`

Applications by status.

**Auth:** admin

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/volunteers/:id`

One application, with a short-lived signed URL for its attachment if it has one (SEC-24).

**Auth:** admin

**Response:** `{ application, documentUrl? }`

**Errors:** 404 `not_found`

#### `POST /api/volunteers/:id/review`

Record a review decision.

**Auth:** admin

**Request body** — `reviewVolunteerSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | `contacted` \| `verified` \| `declined` \| `withdrawn` | yes | — |
| `reviewNote` | string | yes | min length 3, max length 2000 |

**Response:** `{ application }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/volunteers/:id/approve`

Convert to a draft tutor account.

**Auth:** admin

**Request body** — `approveVolunteerSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `password` | string | yes | min length 12, max length 200 |
| `reviewNote` | string | yes | min length 3, max length 2000 |

**Response:** `{ application, tutorUserId }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The new account is a **draft** and must clear §6.6 verification before it is searchable. A volunteer is verified on exactly the same basis as a paid tutor; the flag never substitutes for verification (FR-33.10).

## Moderation and administration

*Specification §6.14, §6.6, §6.28.*

Every administrator decision that affects a person writes an append-only audit entry carrying actor, action, target, timestamp and reasoning (FR-14.4, NFR-19, SEC-13). **`admin_actions` is never updated or deleted** — a mistake is corrected by appending a corrective entry, and the guarded database handle throws if anything tries otherwise (§2.7). Verification is platform-owned: only an administrator can approve a tutor, only against a CNIC and academic documents, and the record states **which artefacts were checked** (§2.5).

#### `POST /api/flags`

Report a profile, review, vacancy, booking or user (FR-14.1, SEC-10).

**Auth:** any authenticated

**Request body** — `createFlagSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `targetType` | `tutor_profile` \| `review` \| `vacancy` \| `user` \| `booking` | yes | — |
| `targetId` | string | yes | min length 1 |
| `reason` | string | yes | min length 3, max length 200 |
| `detail` | string | no | nullable, max length 2000 |

**Response:** `{ flag }`

**Errors:** 400 `validation_failed`

> There is no `message` target: §4.2 puts in-app chat permanently out of scope and §2.3 forbids any private tutor-to-minor channel, so no message entity exists to flag. `user` and `booking` are what make SEC-10’s "requesting families as well as tutors" true rather than half true.

#### `GET /api/admin/dashboard`

Live counts for every queue FR-14.3 names.

**Auth:** admin

**Response:** `{ counts }` — see the appendix

**Errors:** 400 `validation_failed` where a body or query is validated

> Counts only. No row, no id and no name crosses this boundary, which is what lets an administrator-only screen read the unapproved-profile table without becoming a second listing surface that skipped the gender filter and the searchable-status gate.

#### `GET /api/admin/flags`

The open flag queue, oldest first (FR-14.2).

**Auth:** admin

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Oldest first: a report that has waited longest is the one most likely to be about something still happening.

#### `GET /api/admin/flags/:targetType/:targetId`

Report history for one target — "has this happened before?"

**Auth:** admin

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed`

> Administrators only. The reporter’s identity is never shown to the target of the report: a family that reports a tutor and then finds the tutor knows who reported will not report again.

#### `POST /api/admin/flags/:id/resolve`

Resolve with a written reason. Audited.

**Auth:** admin

**Request body** — `resolveFlagSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `decision` | `actioned` \| `dismissed` | yes | — |
| `reason` | string | yes | min length 15, max length 2000 |

**Response:** `{ flag }`

**Errors:** 404 `not_found`, 409 `flag_already_resolved`

> A resolution needs words — fifteen characters minimum. An audit trail of the word "dismissed" is a log, not a record. A flag resolves once: re-resolving would append an entry describing a transition that did not happen.

#### `GET /api/admin/organisations`

Organisations awaiting approval (FR-6.11).

**Auth:** admin

**Response:** `{ items[], count }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/admin/organisations/:id/decision`

Approve or reject with a written reason. Audited.

**Auth:** admin

**Request body** — `decideOrgApprovalSchema`, generated from the Zod schema:

| Field | Type | Required | Constraints |
|---|---|---|---|
| `decision` | `approved` \| `rejected` | yes | — |
| `reason` | string | yes | min length 15, max length 2000 |

**Response:** `{ organisation }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `GET /api/admin/verifications`

The tutor verification queue, stably sorted (FR-6.4).

**Auth:** admin

**Response:** `{ items[], total }`

**Errors:** 400 `validation_failed` where a body or query is validated

> Filterable to profiles carrying an open duplicate-CNIC flag, so the queue can be narrowed to the ones that most need a person (FR-28.7).

#### `GET /api/admin/verifications/:tutorId`

One tutor’s submission and decision history.

**Auth:** admin

**Response:** `{ profile, documents[], records[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/admin/verifications/:tutorId/documents/:documentId/view`

Issue a short-lived signed URL for a verification document.

**Auth:** admin

**Response:** `{ url, expiresInSeconds, docType }`

**Errors:** 400 `validation_failed` where a body or query is validated

> A POST rather than a GET because it **writes**: every access is logged before the URL is issued (SEC-7, NFR-9).

#### `POST /api/admin/verifications/:tutorId/approve`

Approve identity against itemised artefacts.

**Auth:** admin

**Response:** `{ record }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The record names the artefacts checked — CNIC, academic document, or both — and the public badge is generated from that list, so "verified" can never mean more on the profile than the administrator actually looked at. Badge wording never implies a police or background check, because none is performed (FR-6.5, FR-6.8, SEC-6).

#### `POST /api/admin/verifications/:tutorId/reject`

Reject with a written reason. Appealable (SEC-18).

**Auth:** admin

**Response:** `{ record }`

**Errors:** 400 `validation_failed` where a body or query is validated

> One row per decision, ever. A later decision supersedes an earlier one by pointing at it; the earlier row stays exactly as written.

#### `POST /api/admin/verifications/:tutorId/request-info`

Ask for more information.

**Auth:** admin

**Response:** `{ record }`

**Errors:** 400 `validation_failed` where a body or query is validated

> A decision, not a non-decision: written, reasoned and audited like the other two, because from the tutor’s side it is an outcome that leaves them unable to work.

#### `GET /api/admin/verifications/appeals/open`

Open appeals, oldest first (FR-28.6).

**Auth:** admin

**Response:** `{ items[] }`

**Errors:** 400 `validation_failed` where a body or query is validated

#### `POST /api/admin/verifications/appeals/:appealId/decide`

Human override of a verdict (FR-28.6, decision 12).

**Auth:** admin

**Response:** `{ appeal }`

**Errors:** 400 `validation_failed` where a body or query is validated

> The prior attempt is retained and never overwritten (FR-28.4).

## Appendix — the administrator dashboard contract

Unusually, this response has a Zod schema (`adminDashboardCountsSchema`), so it is generated like a request shape. FR-14.3 names each count.

| Field | Type | Required | Constraints |
|---|---|---|---|
| `pendingVerifications` | integer | yes | min 0 |
| `documentsAwaitingReview` | integer | yes | min 0 |
| `pendingOrganisations` | integer | yes | min 0 |
| `openFlags` | integer | yes | min 0 |
| `safetyConcernReviews` | integer | yes | min 0 |
| `openVerificationAppeals` | integer | yes | min 0 |
| `expiringVerifications` | integer | yes | min 0 |
| `openDisputes` | integer | yes | min 0 |
| `newFeedback` | integer | yes | min 0 |
| `newVolunteerApplications` | integer | yes | min 0 |
| `unmetDemandGaps` | integer | yes | min 0 |
| `activeEngagements` | integer | yes | min 0 |
| `usersByRole` | object (map) | yes | — |

---

124 routes across 16 sections. Generated by `npm run docs:api` from the Zod schemas in `/shared` and the route table in `scripts/generate-api-docs.ts`.
