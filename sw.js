/* Service Worker – macht das Logbuch offline nutzbar.
   Bei jeder Änderung an den App-Dateien CACHE hochzählen (v2, v3 …),
   damit Handys die neue Version sicher übernehmen. */
const CACHE = 'tauch-logbuch-v10';

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

// GitHub Pages erlaubt Browsern, Dateien 10 Minuten zwischenzuspeichern (max-age=600).
// Deshalb beim Installieren am Browser-Zwischenspeicher vorbei laden, sonst landet evtl. die alte Version im Cache.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst aus dem Cache antworten (schnell, offline), im Hintergrund beim Server nachfragen.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate';
  const key = isPage ? './' : req;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    // "no-cache": Browser fragt beim Server nach, ob sich die Datei geändert hat (unverändert = kurze Antwort)
    const network = fetch(isPage ? new Request('./', { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' }))
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
