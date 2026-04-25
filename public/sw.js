/* DJ TITAN — Offline-first Service Worker
   Strategy:
   - HTML/navigation → network-first with cache fallback
   - Same-origin static (CSS/JS/images/fonts) → stale-while-revalidate
   - CDN assets (Google Fonts, jsDelivr) → cache-first once seen
   - Everything cached stays reachable offline forever */

const CACHE = 'djtitan-shell-v111-xdjxz-neon';
const CDN_CACHE = 'djtitan-cdn-v111';
const SHELL = [
  './','./index.html',
  './analyzer.worker.js','./manifest.json','./icon.svg','./auth.sql'
];
const CDN_HOSTS = [
  'fonts.googleapis.com','fonts.gstatic.com',
  'cdn.jsdelivr.net','unpkg.com','cdnjs.cloudflare.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== CDN_CACHE).map(k => caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'PRECACHE_CDN') {
    const urls = event.data.urls || [];
    event.waitUntil(caches.open(CDN_CACHE).then(c =>
      Promise.all(urls.map(u =>
        fetch(u, {mode:'cors', credentials:'omit'})
          .then(r => r.ok ? c.put(u, r.clone()) : null)
          .catch(() => null)
      ))
    ));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;
  const isCdn = CDN_HOSTS.some(h => url.host === h || url.host.endsWith('.'+h));

  // Don't interfere with auth/streaming endpoints
  if (url.pathname.includes('/auth/') || url.pathname.startsWith('/rest/')) return;

  // HTML / navigation — network-first, offline fallback to cached shell
  if (req.destination === 'document' || req.mode === 'navigate' ||
      (isSameOrigin && url.pathname.endsWith('.html'))) {
    event.respondWith(
      fetch(req).then(fresh => {
        if (fresh && fresh.ok) caches.open(CACHE).then(c => c.put(req, fresh.clone())).catch(()=>{});
        return fresh;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Same-origin static — stale-while-revalidate
  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(fresh => {
          if (fresh && fresh.ok) caches.open(CACHE).then(c => c.put(req, fresh.clone())).catch(()=>{});
          return fresh;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cached CDN (fonts, Supabase SDK, SoundTouch) — cache-first forever
  if (isCdn) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(fresh => {
          if (fresh && (fresh.ok || fresh.type === 'opaque')) {
            caches.open(CDN_CACHE).then(c => c.put(req, fresh.clone())).catch(()=>{});
          }
          return fresh;
        }).catch(() => caches.match(req));
      })
    );
  }
});
