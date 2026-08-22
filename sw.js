/* Kipad service worker — offline-first PWA */
const CACHE = 'kipad-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/sexpr.js',
  './js/footprints.js',
  './js/kicad_pcb.js',
  './js/gerber.js',
  './js/drill.js',
  './js/board.js',
  './js/render.js',
  './js/kicad_mod.js',
  './js/kicad_sym.js',
  './js/symbols.js',
  './js/schematic.js',
  './js/app.js',
  './lib/footprints.json.gz',
  './lib/footprints.json',
  './lib/symbols.json.gz',
  './lib/symbols.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
