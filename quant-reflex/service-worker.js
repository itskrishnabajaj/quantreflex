/**
 * Service Worker for Quant Reflex Trainer
 * Caches all HTML, CSS, and JS files for offline use.
 */

const CACHE_NAME = 'quant-reflex-v1';

const ASSETS = [
  './',
  './index.html',
  './learn.html',
  './drill.html',
  './test.html',
  './progress.html',
  './style.css',
  './app.js',
  './drill-engine.js',
  './questions.js',
  './progress.js',
  './manifest.json'
];

/* Install: pre-cache all assets */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

/* Activate: clean up old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch: serve from cache, fall back to network */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
