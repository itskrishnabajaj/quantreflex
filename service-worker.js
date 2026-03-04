/**
 * Service Worker for Quant Reflex Trainer (SPA)
 * Caches all assets for offline use.
 */

var CACHE_NAME = 'quant-reflex-v20';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/firebase.js',
  './js/auth.js',
  './js/firestore-sync.js',
  './js/app.js',
  './js/router.js',
  './js/drill-engine.js',
  './js/questions.js',
  './js/progress.js',
  './js/tables.js',
  './js/formulas.js',
  './js/learn-manager.js',
  './js/settings.js',
  './js/notifications.js',
  './js/soundEngine.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './sounds/drillend.mp3',
  './sounds/settingstoggle.mp3',
  './sounds/tablemodalopeningandclosing.mp3',
  './sounds/tabswitching.mp3',
  './sounds/wronganswer.mp3'
];

/* Firebase CDN scripts — cached at runtime for offline support */
var CDN_SCRIPTS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js'
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

/* Fetch: serve from cache, fall back to network.
   For Firebase CDN scripts, cache them on first fetch for offline use.
   For Firebase API requests (auth/firestore), always go to network. */
self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  /* Let Firebase SDK handle its own API requests — don't intercept.
     Use hostname-based checks to avoid substring false positives. */
  try {
    var reqUrl = new URL(url);
    var host = reqUrl.hostname;
    if (host.endsWith('.googleapis.com') ||
        host.endsWith('.firebaseio.com') ||
        host.endsWith('.firebaseinstallations.googleapis.com')) {
      return;
    }
  } catch (e) { /* non-HTTP requests — proceed normally */ }

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        /* Cache Firebase CDN scripts on first fetch for offline support */
        if (response.ok) {
          var urlBase = url.split('?')[0];
          if (CDN_SCRIPTS.indexOf(urlBase) !== -1) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
        }
        return response;
      });
    })
  );
});

/* ---- Push Notification Handling ---- */

/* Motivational messages for background push notifications */
var PUSH_MESSAGES = [
  { title: '🧮 Time to Practice!', body: 'A quick mental math session can sharpen your skills.' },
  { title: '📐 Math Reflex Check', body: 'Keep your calculation speed sharp — practice now!' },
  { title: '🔥 Streak Alert!', body: 'Don\'t break your streak! Solve a few questions today.' },
  { title: '💪 You\'re Getting Better!', body: 'Consistent practice leads to exam success. Start now!' },
  { title: '🎯 Daily Goal Reminder', body: 'Have you hit your daily question target yet?' }
];

/* Handle push events (background notifications from FCM) */
self.addEventListener('push', function (event) {
  var data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { notification: { title: 'Quant Reflex Trainer', body: event.data.text() } };
    }
  }

  var notif = data.notification || {};
  var title = notif.title || 'Quant Reflex Trainer';
  var body = notif.body || PUSH_MESSAGES[Math.floor(Math.random() * PUSH_MESSAGES.length)].body;

  var options = {
    body: body,
    icon: './icons/icon-192.svg',
    badge: './icons/icon-192.svg',
    tag: 'quant-motivation',
    renotify: true,
    data: { url: './index.html#home' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Handle notification click — open app to Home tab */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var urlToOpen = './index.html#home';
  if (event.notification.data && event.notification.data.url) {
    urlToOpen = event.notification.data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      /* If app is already open, focus it and navigate */
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].url.indexOf('index.html') !== -1 || clients[i].url.endsWith('/')) {
          return clients[i].focus();
        }
      }
      /* Otherwise open a new window */
      return self.clients.openWindow(urlToOpen);
    })
  );
});
