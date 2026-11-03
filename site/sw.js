/* GROYPER Rewards service worker: caches ONLY this site's own static files.
   Never touches RPC/API traffic: every cross-origin request (Solana RPC, Jupiter,
   token images) and every non-GET request bypasses the worker entirely. */
var VERSION = 'groyper-shell-20261103b';
var SHELL = ["/", "/css/style.css", "/data/burns.json", "/data/forecast.json", "/data/leaderboard.json", "/data/wallets.json", "/favicon.ico", "/img/groyper.jpg", "/img/icons/apple-touch-icon.png", "/img/icons/favicon-32.png", "/img/icons/icon-192.png", "/img/icons/icon-512.png", "/img/icons/maskable-192.png", "/img/icons/maskable-512.png", "/js/app.js", "/js/config.js", "/js/pwa.js", "/manifest.webmanifest"];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('groyper-shell-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // RPC POSTs etc.: never intercepted
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // cross-origin: never intercepted or cached
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    // Network-first so a new deploy shows up immediately; cached page only when offline.
    e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('/index.html', copy); }); }
      return res;
    }).catch(function () { return caches.match('/index.html').then(function (r) { return r || caches.match('/'); }); }));
    return;
  }
  if (SHELL.indexOf(url.pathname) === -1) return;         // only known static files are served from cache
  if (url.pathname.indexOf('/data/') === 0) {
    // Data snapshots are rebuilt regularly: network-first, cached copy only when offline.
    e.respondWith(fetch(req, { cache: 'no-store' }).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(url.pathname, copy); }); }
      return res;
    }).catch(function () { return caches.match(url.pathname); }));
    return;
  }
  e.respondWith(caches.open(VERSION).then(function (c) {
    return c.match(url.pathname).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res.ok) c.put(url.pathname, res.clone()); return res; });
    });
  }));
});
