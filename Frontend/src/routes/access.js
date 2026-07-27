/**
 * How much of the navigation one signed-in person may reach.
 *
 * ── What this switch does, and what it cannot do ──────────────────────────
 * `OPEN_NAVIGATION` relaxes a **client-side courtesy**. `RoleGuard` and the
 * navigation list exist so an ordinary user is never shown a door that will
 * not open; they were never a security control, and the file header on
 * `RoleGuard` has always said so.
 *
 * The actual enforcement is server-side and is **not touched by this flag**:
 * every mutating endpoint checks role *and* resource ownership on every
 * request (NFR-6), `requireRole` sits in front of every role-scoped route, and
 * a tutor asking for another family's student profile gets a 404 whatever the
 * browser believes. Turning this on lets somebody *open* a screen; it does not
 * let them read or write anything the API would refuse.
 *
 * ── Why it exists ─────────────────────────────────────────────────────────
 * A demonstration is walked by one person with one account. Making them sign
 * out and back in five times to show five roles turns a five-minute tour into
 * a login exercise, and every switch is a chance for something to go wrong in
 * front of an audience.
 *
 * ── What it costs ─────────────────────────────────────────────────────────
 * A screen opened by the wrong role still calls its endpoints, and those
 * endpoints still refuse. So a parent opening `/tutor/schedule` sees the page
 * shell and an error state where the data would be — which is the honest
 * result, and the reason this is a demonstration convenience rather than a
 * default.
 *
 * Authentication is still required. Anonymous visitors get exactly what
 * FR-1.6 promises — browsing, search, tutor profiles, the vacancy board and
 * the demonstration panel — and nothing more.
 *
 * Set to `false` to restore per-role navigation.
 */
export const OPEN_NAVIGATION = true;
