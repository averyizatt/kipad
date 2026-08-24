/* Kipad service worker — offline-first PWA */
const CACHE = 'kipad-v13';
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
  './js/erc.js',
  './js/zones.js',
  './js/app.part1.js',
  './js/app.part2.js',
  './js/app.part3.js',
  './js/app.part4.js',
  './lib/footprints.json.gz',
  './lib/footprints.json',
  './lib/symbols.json.gz',
  './lib/symbols.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];
// KiCad source icons (GPL-3.0, from KiCad kicad-source-mirror resources/bitmaps_png)
const ICONS = [
  'arc','bitmap2comp','calculator','circle','component','cursor','cvpcb','drc','drill','eeschema',
  'add_zone','text','erc','exit','gerbview','glabel','help','highlight','import','junction','kicad','measure','module_editor',
  'netlist','new_project','open_project','pcbnew','ratsnest','redo','refresh','save','symbol','tracks',
  'undo','via','zoom_fit','zoom_in','zoom_out',
  'gerber','grid','line','pcm','rect',
  'icon_cvpcb_128','icon_eeschema_128','icon_gerbview_128','icon_kicad_128','icon_libedit_128',
  'icon_modedit_128','icon_pcbcalculator_128','icon_pcbnew_128','icon_pcm_128'
].map(n => './icons/' + n + '.png');
ASSETS.push(...ICONS);

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
