/* LensCal service worker — network-first for the shell (deploys show
   instantly), stale-while-revalidate for assets. Firestore/Auth traffic
   is never intercepted (the SDK has its own offline handling). */
const CACHE = 'lenscal-v1';
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  // never intercept Firebase, Nominatim, Anthropic or OSM tiles
  if (/googleapis\.com|gstatic\.com|firebaseio\.com|nominatim|anthropic\.com|openstreetmap\.org/.test(url.hostname)
      && !url.hostname.includes('fonts')) {
    return;
  }

  // navigations: network-first
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // same-origin assets + unpkg (Leaflet): stale-while-revalidate
  const cacheable = url.origin === location.origin || url.hostname === 'unpkg.com';
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
