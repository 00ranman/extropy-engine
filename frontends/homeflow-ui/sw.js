/*
 * HomeFlow service worker.
 *
 * Strategy:
 *   1. Cache-first for the static shell (HTML, CSS, JS, icons, manifest).
 *   2. Network-first with cache fallback for /api GETs, so the UI keeps
 *      rendering with stale data when the LAN drops.
 *   3. Network-only for /api writes and /auth, which must always reach
 *      the server fresh.
 *
 * Bump CACHE_VERSION whenever the shell file list changes so old caches
 * get evicted on activate.
 */

const CACHE_VERSION = 'homeflow-shell-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/auth.css',
  '/app.js',
  '/auth.js',
  '/psll.js',
  '/did-onboard.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {
      // Best effort. A missing asset must not block install.
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isApiGet(request, url) {
  return request.method === 'GET' && url.pathname.startsWith('/api/');
}

function isApiWrite(request, url) {
  return request.method !== 'GET' && url.pathname.startsWith('/api/');
}

function isAuth(url) {
  return url.pathname.startsWith('/auth/') || url.pathname === '/auth';
}

function isShellAsset(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  return (
    SHELL_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname === '/' ||
    url.pathname === '/index.html'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (isAuth(url) || isApiWrite(request, url)) {
    return;
  }

  if (isApiGet(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (isShellAsset(request, url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      }),
    );
  }
});
