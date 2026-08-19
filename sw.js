/* Fantasy Studio service worker
   Strategy: network-first for the page (deploys always show instantly;
   cache is the offline fallback), stale-while-revalidate for assets, and
   network-first-with-timeout for app code (see APP_CODE below). */
const CACHE = 'fs-cache-v13';   // v13: catalog.js + the /builder/ page
const PREFIX = 'fs-cache-';
// Only the public shell. The admin and client apps used to be precached here,
// which cost every first-time visitor ~133 KB for two pages they will never
// open; both are cached on their own first visit by the asset path below.
const PRECACHE = [
  './',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll is atomic: one 404 aborts the whole install and NOTHING gets
      // cached. Add individually so a single bad entry cannot leave the site
      // with no offline copy at all.
      .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // CacheStorage is origin-scoped, not scope-scoped, so an unqualified
      // sweep would delete every app's cache on this origin, not just ours.
      // Only ever retire our own older versions.
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first, but bounded: whichever of "the network answered" or "the
// timeout expired and we have a cached copy" comes first wins. The request is
// never abandoned — it still populates the cache, so a slow load now means a
// fresh one next time.
function freshOrCached(req, ms) {
  return new Promise(resolve => {
    let settled = false;
    const done = r => { if (!settled && r) { settled = true; resolve(r); } };
    const timer = setTimeout(() => { caches.match(req).then(done); }, ms);
    fetch(req)
      .then(res => {
        clearTimeout(timer);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        done(res);
      })
      .catch(() => {
        clearTimeout(timer);
        // offline: the cached copy is all there is. Resolving with undefined
        // would hang the request forever, so fall through to a real failure.
        caches.match(req).then(m => { done(m); done(Response.error()); });
      });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  // never intercept analytics
  if (url.hostname.includes('googletagmanager.com') || url.hostname.includes('google-analytics.com')) return;

  // the page itself: network-first so every deploy shows immediately.
  // Cached under its own URL — the admin page must not overwrite the home page's offline copy.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          // only store a good response: a 404/500 page was being kept as the
          // offline copy, so a transient server error became the page the user
          // saw every time they opened the site offline afterwards
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(m => m || caches.match('./')))
    );
    return;
  }

  // App code: index.html + app.css + app.js, plus tokens.css, ui.css and
  // catalog.js (the public site's prices, packages and lead writer).
  // The two new ones MUST be in this branch, not the cache-first one below.
  // app.css now declares no colours of its own — every value it uses is a
  // token. A fresh app.css served against yesterday's cached tokens.css is a
  // panel with no colours at all, which is the same deploy-skew failure this
  // branch exists to prevent, just louder.
  // The page is network-first and its assets are cache-first, so a deploy
  // could hand a browser new HTML running yesterday's app.js — on a panel that
  // records payments, that is not a class of bug worth accepting, and no
  // version-query scheme survives being forgotten at deploy time.
  //
  // So: ask the network, but never wait on it. Past the timeout the cached
  // copy is served and the panel boots — which is the venue-on-one-bar case
  // the app is built around — while the fetch carries on and refreshes the
  // cache for next time.
  if (url.origin === location.origin && /\/(app|tokens|ui|catalog)\.(js|css)$/.test(url.pathname)) {
    e.respondWith(freshOrCached(req, 2500));
    return;
  }

  // assets (same-origin, fonts, Firebase SDK, jsPDF CDN): serve cache fast, refresh in background.
  // www.gstatic.com matters: without it the admin cannot boot offline at all.
  const cacheable = url.origin === location.origin
    || url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
    || url.hostname === 'www.gstatic.com'
    || url.hostname === 'cdnjs.cloudflare.com';
  if (!cacheable) return;

  e.respondWith(
    caches.match(req).then(cached => {
      const refresh = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
