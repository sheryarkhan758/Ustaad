# Ustaad.com — Frontend

React 18 + Vite in JavaScript, Tailwind, delivered as an installable PWA.
The API it talks to lives in `../Backend`.

```bash
npm install
npm run dev          # http://localhost:5173, /api proxied to :3000
```

Run the backend alongside it: `cd ../Backend && npm run dev`.

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server, `/api` proxied |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the build — **the only way to test the service worker** |
| `npm run lint` | ESLint |
| `npm run icons` | Rasterise the PWA icon set from `public/icons/icon.svg` |

---

## Design decisions

### Palette

Anchored on the specification's own identity and built toward the visual
language of a **record** — a matriculation certificate, a bank passbook, a
NADRA card — rather than a marketplace.

| Token | Hex | Role |
|---|---|---|
| `ink` | `#1B3A57` | Primary text and actions |
| `verdigris` | `#0F7B8A` | Fills, borders, accents |
| `verdigris-deep` | `#0A5D69` | Teal **text** |
| `slate` | `#5A6E7F` | Secondary text, rules |
| `paper` | `#F1F4F7` | Page ground — cool blue-grey, not warm cream |
| `seal` | `#A8763E` | Brass. **Verification record only** |
| `flag` | `#A32F27` | Errors and safety flags |

**Two teals, on purpose.** `#0F7B8A` measures roughly 4.1:1 on white and fails
WCAG AA for body text. Using one brand teal everywhere would mean every teal
link in the product quietly failing the contrast floor, so fills use
`verdigris` and text uses `verdigris-deep` (~6.4:1).

**`seal` is scarce by rule.** The brass ochre appears in exactly one component —
the Verification Record — and nowhere else. Scarcity is what makes it read as a
stamp rather than as decoration. It never carries text on a light ground.

Every value lives in `tailwind.config.js`. **No component writes a raw hex in
JSX.**

### Type

- **Display:** Source Serif 4 (Latin) + Noto Nastaliq Urdu (Urdu)
- **Body and UI:** IBM Plex Sans (Latin) + IBM Plex Sans Arabic (Urdu)

Plex Sans and Plex Sans Arabic are one designed family, which is the reason for
choosing them: the Urdu interface should not look bolted onto the English one.

**Nastaliq is display-only.** It is the more beautiful script and the wrong tool
for a form label — slower to read at size, and its cascading baseline needs
`line-height: 2.4`, which makes a 44px tap target look cramped. Naskh carries
body and controls at `1.9`. Latin body sits at `1.5`. Those are three separate
tokens because a bilingual page renders all of them at once.

Numerals stay Western-Arabic in both views (FR-27.6): an amount that changes
numeral system between languages is an amount somebody misreads.

### The signature element — the Verification Record

`src/components/verification/VerificationRecord.jsx`.

A tick beside a name says "trust this person" and takes responsibility for
nothing. The platform's actual claim is narrower and far more useful: *an
administrator looked at these documents, on this date, and here is who they
were.* So it is drawn as a record — squarer corners than anything else in the
product, tabular figures, an itemised list, a seal.

1. **Itemised** — one row per artefact, each with its own date (FR-6.5)
2. **Attributed** — the approving administrator is named (FR-6.6)
3. **States what was *not* done** — *"No police or background check is
   performed"* is printed on the card, at the same size as the attribution
   above it. Not smaller, not greyer. A parent deciding who enters their home
   needs the limit of the claim, and a product that only advertises its
   strengths has told them the less useful half (SEC-6, FR-6.8)
4. **Two tracks, never merged** — identity and competency stay separate, so a
   strong assessment cannot paper over a weak identity check (FR-6.2)
5. **The seal** — the one place `seal` colour appears

`assertPermittedBadgeText` throws in development if the words *Trusted*, *Safe*,
*Vetted*, *Background checked*, *Police verified*, *Screened* or *Certified
safe* reach any verification copy. The backend guards the strings it generates;
this is the matching guard on the surface that renders them.

---

## Architecture

```
src/
  components/ui/          Button, Field, Card, Modal — the primitives
  components/layout/      AppShell, FeedbackDialog
  components/verification/  The signature element
  context/                AuthContext (stubbed), ComparisonTrayContext
  lib/                    api.js (the one fetch wrapper), queryClient.js
  pages/                  Route groups: public, parent, tutor, organisation, admin
  pwa/                    Install prompt, service-worker registration
  routes/                 Route table, RoleGuard
```

**`lib/api.js` is the only place `fetch` is called.** The session is an httpOnly
cookie and the server has no `Authorization` header path, so a request that
forgets `credentials: 'include'` is not slightly wrong — it is anonymous, and the
failure looks like a permissions bug. One wrapper is the only way to be sure.

**Role guards are cosmetic and are documented as such.** The server checks role
*and* resource ownership on every mutating endpoint. What `RoleGuard` buys is
that an honest user is never shown a door that will not open.

**Auth is stubbed** in `context/AuthContext.jsx` (`USE_STUB = true`), returning
the exact shape `GET /api/auth/me` returns. Walk the interface as any role:

```js
localStorage.setItem('ustaadStubRole', 'admin'); // or anonymous, parent, tutor…
```

### TanStack Query defaults

Chosen for a mid-range Android phone on a metered connection:

- **`refetchOnWindowFocus: false`** — the default that costs a metered
  connection most for least benefit. Every app switch becomes a data charge.
- **Mutations never retry.** A mutation here creates a booking or acknowledges
  a payment; replaying one because a response was slow risks doing it twice.
- **Retries skip 4xx.** A 401 will not become a 200 on the third attempt.

---

## PWA

This is how the project satisfies its Android requirement from one codebase
(§10.4), so it has to work rather than merely exist.

```bash
npm run build && npm run preview   # the worker is disabled in dev, by design
```

Then Chrome → ⋮ → *Add to home screen*. It launches full-screen with a splash
from `manifest.webmanifest`.

**`/api/*` is never cached and never served from cache.** This platform holds
children's names, session notes, encrypted addresses and payment records. A
cached API response is that data written to disk on a shared family phone,
surviving sign-out, and served to whoever picks the phone up next. The worker
caches the shell only.

The install prompt is deferred rather than fired on first paint, and a dismissal
is remembered for sixty days — re-prompting someone who declined is how a banner
becomes an ad.

---

## Quality floor

- **320px**, not 360. NFR-8 says 320, and that is the stricter number.
- **44px minimum tap target**, 48px for primary actions (WCAG 2.5.5).
- **Visible keyboard focus** via `:focus-visible`, two-tone so the ring survives
  on both paper and ink grounds. A skip link is the first focusable element on
  every page.
- **Reduced motion respected** — the skeleton shimmer is exactly the repeating
  sweep that triggers vestibular symptoms, and it flattens to a static block.
- **AA contrast**, which is why there are two teals.
- **16px minimum on inputs** — iOS Safari zooms a focused input below that, and
  on a booking form it throws the layout sideways mid-entry.

`/styleguide` renders every primitive in every state. It uses the real
components, never copies, so it cannot drift from the product.

---

## Not built yet

Honest list, so nothing above reads as more finished than it is.

1. **Fonts are not self-hosted.** The stacks fall back to system faces until
   `public/fonts/` is populated. Self-hosting rather than Google Fonts is
   deliberate: a third-party font request is a render-blocking round trip to a
   host that may be slow from Pakistan, and it leaks every visitor's IP.
2. **i18n is scaffolded, not wired.** The header toggle is present and inert;
   `i18next` is installed. FR-27.1 requires every string externalised — the
   current copy is inline and must move to a dictionary.
3. **Every page except the landing and the styleguide is a stub.**
4. **Auth is stubbed** — see above.
