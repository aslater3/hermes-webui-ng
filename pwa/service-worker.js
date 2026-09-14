/* Generated build inputs. Cache only fixed public shell files, never runtime responses. */
const VERSION = '__BUILD_ID__';
const PREFIX = 'hermesui-ng-shell-';
const CACHE = PREFIX + VERSION;
const PATHS = __PRECACHE__;
const allowed = new Set(PATHS);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      for (const path of PATHS) {
        const response = await fetch(new Request(new URL(path, self.location.origin), {
          credentials: 'omit', cache: 'reload', redirect: 'error',
        }));
        if (!response.ok || response.type === 'opaque' || response.headers.get('x-webui-static') !== '1')
          throw new Error('Static shell unavailable');
        await cache.put(path, response);
      }
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
  // Never skipWaiting on install: active conversations and drafts must not be replaced.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Retain one previous static build; it is never a conversation history cache.
    const old = (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE);
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length <= 1) for (const name of (clients.length ? old.slice(0, -1) : old)) await caches.delete(name);
    await self.clients.claim();
  })());
});
const offline = () => new Response('Offline shell unavailable. Reconnect and reload HermesUI NG.', { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || (url.hash && request.mode !== 'navigate') || !allowed.has(url.pathname)) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    // Keep HTML and hashed assets on the same build until activation is approved.
    event.respondWith(caches.match('/', { cacheName: CACHE }).then(cached => cached || fetch(request).catch(offline)));
  } else {
    event.respondWith(caches.match(url.pathname, {cacheName:CACHE}).then(cached => cached || fetch(request)));
  }
  // No cache.put here: auth, API results, files, query strings and transcripts never enter storage.
});
self.addEventListener('message', event => {
  const source = event.source;
  if (!source || !('url' in source) || new URL(source.url).origin !== self.location.origin) return;
  if (event.data?.type === 'HERMES_VERSION') { event.ports[0]?.postMessage({ version: VERSION }); return; }
  if (event.data?.type !== 'HERMES_ACTIVATE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length !== 1 || windows[0].id !== source.id) {
      event.ports[0].postMessage({ result: 'other-tabs' }); return;
    }
    event.ports[0].postMessage({ result: 'activating' });
    await self.skipWaiting();
  })());
});
