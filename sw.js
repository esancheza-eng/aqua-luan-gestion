/* Aqua Luan Bodega — service worker. Sube CACHE_NAME en cada versión nueva. */
const CACHE_NAME = 'luan-bodega-v3.1.4';
const APP_SHELL = ['./', './index.html', './app.js?v=3.1.4', './manifest.json', './logo-luanaqua.png'];
const CDN = [
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore-compat.js'
];
function esEstatico(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'www.gstatic.com' || h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com' || h === 'aqualuanpedidos.elhyai.com';
  } catch (e) { return false; }
}
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const u of APP_SHELL) { try { await cache.add(u); } catch (err) {} }
    for (const u of CDN) {
      try { const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await cache.put(u, r.clone()); } catch (err) {}
    }
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Red primero (siempre la versión más nueva), caché si no hay internet */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const mismo = new URL(e.request.url).origin === self.location.origin;
  if (!mismo && !esEstatico(e.request.url)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res && res.status === 200) { const c = res.clone(); caches.open(CACHE_NAME).then(x => x.put(e.request, c)).catch(() => {}); }
      return res;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (mismo && e.request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
