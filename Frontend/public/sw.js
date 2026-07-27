/**
 * Service worker — NFR-8, §10.4.
 *
 * This is how the project satisfies its Android requirement from one codebase,
 * so it has to actually work rather than merely exist.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 * **`/api/*` is never cached, and never served from cache.**
 *
 * This platform holds children's names, session notes, encrypted addresses and
 * payment records. A cached API response is that data written to disk on a
 * shared family phone, surviving sign-out, and served to whoever picks the
 * phone up next. TanStack Query already caches in memory for the session, which
 * is the right lifetime for it.
 *
 * So the worker caches the *shell* — the HTML, JS, CSS and icons that make the
 * app open at all — and nothing else.
 *
 * ── Strategies ────────────────────────────────────────────────────────────
 *  · Navigations: network first, falling back to the cached shell. A user with
 *    signal gets the current build; a user in a lift gets the offline page
 *    rather than the browser's dinosaur.
 *  · Static assets: cache first. They are content-hashed by Vite, so a changed
 *    file has a changed URL and staleness is impossible.
 *  · Everything else, including all of `/api`: straight to the network.
 */

const VERSION = 'v1';
const SHELL_CACHE = `ustaad-shell-${VERSION}`;
const ASSET_CACHE = `ustaad-assets-${VERSION}`;

/** Enough to render the frame and say something useful while offline. */
const SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` so an install never re-caches a stale copy from the HTTP cache.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      // Take over at the next navigation rather than waiting for every tab to
      // close — an update nobody receives is not an update.
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('ustaad-') && !name.endsWith(VERSION))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Anything the worker must not touch. */
function isPrivatePath(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/fonts/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET. A POST is a booking, a report, a payment acknowledgement — none
  // of which may be replayed from a cache or retried behind the user's back.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin and API traffic: the worker does not participate at all.
  if (url.origin !== self.location.origin || isPrivatePath(url)) return;

  // Navigations — network first, cached shell as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match('/index.html')) ??
            (await cache.match('/offline.html')) ??
            new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
          );
        }),
    );
    return;
  }

  // Static assets — cache first. Content-hashed, so this cannot go stale.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

/** Lets the page trigger an immediate update rather than waiting a navigation. */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
