/* Fantasy Studio service worker
   Strategy: network-first for the page (deploys always show instantly;
   cache is the offline fallback), network-first-with-timeout for ALL
   executable code (see isCode below), and stale-while-revalidate for the
   remaining assets (images, fonts, manifest). */
const CACHE = 'fs-cache-v20';   // v20: the Portfolio admin script is app code (network-first, below)
                                // v19: executable code is never cache-first — firebase-config.js,
                                //      pdf-template.js, the Firebase SDK modules and jsPDF
                                //      joined the app code below; opaque responses are kept
                                //      for the font hosts only
                                // v18: the availability calendar — avail.js/css is
                                //      app code (network-first, below)
                                // v17: one sign-in — fs-auth.js is app code (network-
                                //      first, below), start/ changed, profile/ is new
                                // v16: the store app's entry page, start/, and the
                                //      app shell (app-shell.css/js) every portal loads
                                // v15: catalog.js gained MAX_QTY (10 per service),
                                //      which the builder reads
                                // v14: the album came out of the builder — a cached
                                //      v13 catalog.js priced st.albumSheets (now absent)
                                //      as undefined × 400 and rendered a NaN total
const PREFIX = 'fs-cache-';
// The site's own executable files, matched on the pathname so a ?v= query
// never hides one. A named list rather than "any .js" on purpose: a file added
// later has to be chosen for the network-first branch, not swept into it by
// accident. (admin/_demo-data.js is the one script left out: it is imported
// with a Date.now() query, so no two loads share a cache key.)
const APP_CODE = /\/(app|app-shell|tokens|ui|catalog|fs-auth|avail|firebase-config|pdf-template|portfolio)\.(js|css)$/;
// Only the public shell. The admin and client apps used to be precached here,
// which cost every first-time visitor ~133 KB for two pages they will never
// open; both are cached on their own first visit by the asset path below.
const PRECACHE = [
  './',
  'start/',            // the store app's entry page: must open with no signal
  'profile/',          // the app's profile step (after a first sign-in, and Me → Edit)
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
        // A server error is not an answer worth showing over a good copy: the
        // Firebase SDK and jsPDF used to be cache-first, so a CDN outage never
        // reached the admin; now that they are network-first, a 5xx has to fall
        // back to the cache too. A 404 stays the network's word (a file that
        // was removed on purpose must not be kept alive by an old copy).
        if (res && res.status >= 500) { caches.match(req).then(m => done(m || res)); return; }
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

/* Warm the cache on demand.
   A page can ask for a set of URLs to be stored — used by the crew page, whose
   install card promises the last schedule opens with no signal. Its own first
   load cannot deliver that: the worker registers on `load`, so the navigation,
   firebase-config.js and the three Firebase modules have all already been
   fetched outside the worker's reach. Fetching them again FROM THE PAGE does
   not reliably help either, because the page may not be controlled yet and
   waiting for that is a race (controllerchange often fires before a listener
   can be attached). Going through the worker itself has no such window. */
self.addEventListener('message', e => {
  const d = e.data;
  if(!d || d.type !== 'warm' || !Array.isArray(d.urls)) return;
  e.waitUntil(
    caches.open(CACHE).then(c =>
      /* individually, and never fatally: one unreachable URL must not throw
         away the rest, exactly as in install() above */
      Promise.all(d.urls.slice(0, 12).map(u => c.add(u).catch(() => {}))))
  );
});

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
        // offline and never cached: the home page falls back to itself, every
        // other page to the app entry (start/ is precached), so an offline
        // in-app navigation can never land on the brochure
        .catch(() => caches.match(req).then(m => m || caches.match(url.pathname === '/' ? './' : 'start/')))
    );
    return;
  }

  // Executable code: index.html + app.css + app.js, plus tokens.css, ui.css and
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
  // app-shell.css/js belong here too: a portal page deployed with a new tab
  // bar against yesterday's cached shell is the same skew.
  // So does fs-auth.js, the one sign-in every portal, /start/ and /profile/
  // import as a namespace: a new page against yesterday's module finds the
  // functions it calls undefined, and sign-in or the portal fails that load.
  // And avail.js/css, the availability calendar the three portals import
  // lazily: the same page-against-yesterday's-module skew.
  //
  // Security, not only skew: the Cache API is writable from any page script,
  // so a cache-FIRST entry for code is a place to plant a script that outlives
  // the bug that planted it — through the fix, a sign-out and every deploy.
  // Network-first makes the cache an offline fallback only, and the next
  // online load overwrites whatever was there. That is why firebase-config.js
  // (it names the project every page talks to), admin/pdf-template.js (it
  // runs inside the admin), the Firebase SDK modules and jsPDF are here too.
  // The two CDNs are matched on host AND path: only those libraries, never
  // everything else the host serves (www.gstatic.com also serves reCAPTCHA).
  const isCode =
       (url.origin === location.origin && APP_CODE.test(url.pathname))
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
    || (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.startsWith('/ajax/libs/jspdf/'));
  if (isCode) {
    e.respondWith(freshOrCached(req, 2500));
    return;
  }

  // assets (same-origin, fonts): serve cache fast, refresh in background.
  // Code from the CDNs is handled above and every other third-party host is
  // left to the browser. Opaque (no-cors) responses are stored for the font
  // hosts only — the Google Fonts stylesheet is a plain <link>, so it is
  // always opaque — and never for anything that could be a script, since an
  // opaque entry cannot be inspected before it is served back.
  const fontHost = url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fontHost) return;

  e.respondWith(
    caches.match(req).then(cached => {
      const refresh = fetch(req)
        .then(res => {
          if (res && (res.ok || (fontHost && res.type === 'opaque'))) {
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
