/* Service Worker – macht das Logbuch offline nutzbar.
   Bei jeder Änderung an den App-Dateien CACHE hochzählen (v2, v3 …),
   damit Handys die neue Version sicher übernehmen. */
const CACHE = 'tauch-logbuch-v8';

// Bewusst ohne "./index.html": manche Server leiten /index.html auf / um,
// und umgeleitete Antworten dürfen nicht für Seitenaufrufe benutzt werden.
const ASSETS = [
  './',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './lib/qrcode.js',
  './lib/jsQR.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst aus dem Cache antworten (schnell, offline), im Hintergrund aktualisieren.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate';
  const key = isPage ? './' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req)
      .then(res => {
        if (res.ok && !res.redirected) cache.put(key, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const res = await network;
    return res || new Response('Offline – diese Datei ist noch nicht gespeichert.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
