/**
 * Service Worker for Quant Reflex Trainer (SPA)
 * Caches all assets for offline use.
 */

var CACHE_NAME = 'quant-reflex-v13';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/drill-engine.js',
  './js/questions.js',
  './js/progress.js',
  './js/tables.js',
  './js/formulas.js',
  './js/learn-manager.js',
  './js/settings.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

/* Install: pre-cache all assets */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(ASSETS); })
  );
  self.skipWaiting();
});

/* Activate: clean up old caches */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

/* Fetch: serve from cache, fall back to network */
self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cached) { return cached || fetch(event.request); })
  );
});
