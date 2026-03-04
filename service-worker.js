/**
 * Service Worker for Quant Reflex Trainer
 * Caches all HTML, CSS, and JS files for offline use.
 */

var CACHE_NAME = 'quant-reflex-v4';

var ASSETS = [
  './',
  './index.html',
  './practice.html',
  './learn.html',
  './stats.html',
  './settings.html',
  './drill.html',
  './test.html',
  './progress.html',
  './style.css',
  './app.js',
  './drill-engine.js',
  './questions.js',
  './progress.js',
  './tables.js',
  './formulas.js',
  './manifest.json'
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
