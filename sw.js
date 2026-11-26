// Service worker: lets the game load offline (local mode works without
// internet) while always preferring the network, so new versions show up
// right away instead of being stuck in a stale cache.

const CACHE = 'capitala-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/board.js',
  './js/bot.js',
  './js/data.js',
  './js/driver.js',
  './js/engine.js',
  './js/fx.js',
  './js/local.js',
  './js/net.js',
  './js/sheet.js',
  './js/text.js',
  './js/ui.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];
const SDK_HOST = 'www.gstatic.com';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same origin: network first (fresh code), cache as offline fallback.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        }),
    );
    return;
  }

  // Versioned Firebase SDK files never change: cache first.
  if (url.hostname === SDK_HOST && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })),
    );
  }
  // Everything else (Firebase realtime traffic) goes straight to the network.
});
