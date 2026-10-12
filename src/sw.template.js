/* Loupe service worker — generated at build time from src/sw.template.js.
 *
 * Update guarantees:
 * 1. Every build gets a unique VERSION, so sw.js changes byte-for-byte on every
 *    deploy and the browser always detects the new worker. It's registered with
 *    updateViaCache: 'none', so the browser's HTTP cache can't hide it.
 * 2. The page itself (index.html) is fetched NETWORK-FIRST, so opening Loupe
 *    online always loads the latest version. The cached copy is only an
 *    offline fallback.
 * 3. A new worker activates immediately (skipWaiting + clients.claim) and tells
 *    open windows, which show a "new version, reload" banner.
 * 4. Hashed JS/CSS files are cache-first: their names change whenever their
 *    content changes, so a cached file is never stale.
 */
const VERSION = __VERSION__;
const ASSETS = __ASSETS__;
const CACHE = `loupe-${VERSION}`;
const INDEX = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: 'reload' bypasses the HTTP cache so we never precache a stale file.
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove every older Loupe cache. Running windows already loaded their
      // code (including the image workers) at startup, so they don't need it.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('loupe-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const w of windows) w.postMessage({ type: 'loupe-activated', version: VERSION });
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'loupe-version') event.source?.postMessage({ type: 'loupe-version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept the worker script itself.
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Revalidate with the server (ETag) instead of trusting the HTTP cache.
          const fresh = await fetch(req, { cache: 'no-cache' });
          if (fresh.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(INDEX, fresh.clone());
          }
          return fresh;
        } catch {
          return (await caches.match(INDEX, { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      // ignoreVary: servers send Vary (Origin / Accept-Encoding), and module
      // script requests carry headers the precache requests didn't, so a strict
      // match would miss and the app would fail offline.
      const cached = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
      return cached || fetch(req);
    })(),
  );
});
