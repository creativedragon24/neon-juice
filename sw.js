/* Neon Dodge service worker — precache everything, serve cache-first.
   Bump CACHE when you ship new assets. */
const CACHE = 'neon-dodge-v6';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/main.js',
  './js/game.js',
  './js/juice.js',
  './js/audio.js',
  './js/settings.js',
  './js/rng.js',
  './js/pixelfont.js',
  './vendor/anime.min.js',
  './vendor/confetti.browser.min.js',
  './vendor/zzfx.min.js',
  './assets/player.png',
  './assets/meteor.png',
  './assets/drone.png',
  './assets/gem.png',
  './assets/powerup.png',
  './assets/bg_stars.png',
  './assets/bg_skyline.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS).catch((err) => console.warn('precache partial', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
