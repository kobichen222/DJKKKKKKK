/* Pioneer DJ Pro MAX — Service Worker
   Caches the shell + library assets so the app boots offline after first visit.
   Strategy: cache-first for same-origin static assets, network-first for everything else. */

const CACHE = 'djpro-shell-v5';
const SHELL = [
  './',
  './index.html',
  './pioneer-dj-pro-max-v2.html',
  './analyzer.worker.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.destination === 'document' || req.mode === 'navigate' || req.url.endsWith('.html')) {
    event.respondWith(
      fetch(req).then(fresh => {
        if (fresh && fresh.ok) caches.open(CACHE).then(c => c.put(req, fresh.clone()));
        return fresh;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(fresh => {
        if (fresh && fresh.ok) caches.open(CACHE).then(c => c.put(req, fresh.clone()));
        return fresh;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
