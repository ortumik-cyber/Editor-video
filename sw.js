// Service worker: guarda la aplicación entera y la sirve sin conexión. Cada versión usa su propia caché.
// La versión la estampa scripts/make-precache.mjs: así el navegador ve cambiar sw.js en cada despliegue.
const BUILD = 'b74b278c71ea';
const LIST = new URL('precache.json', self.location);
const PREFIX = 'editor-video-';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const { version, files } = await (await fetch(LIST, { cache: 'no-store' })).json();
    const cache = await caches.open(PREFIX + version);
    await Promise.all(files.map(async (f) => {
      const response = await fetch(new URL(f, self.registration.scope), { cache: 'reload' });
      if (!response.ok) throw new Error(`No se pudo guardar ${f}`);
      await cache.put(new URL(f, self.registration.scope), response);
    }));
    await cache.put(LIST, new Response(JSON.stringify({ version, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Se conserva la caché instalada más reciente y se borran las demás.
    const found = [];
    for (const key of (await caches.keys()).filter((k) => k.startsWith(PREFIX))) {
      const marker = await (await caches.open(key)).match(LIST);
      found.push({ key, at: marker ? (await marker.json()).at : 0 });
    }
    found.sort((x, y) => y.at - x.at);
    await Promise.all(found.slice(1).map((c) => caches.delete(c.key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { if (event.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') return (await caches.match(new URL('index.html', self.registration.scope))) ?? fetch(request);
    return fetch(request);
  })());
});
