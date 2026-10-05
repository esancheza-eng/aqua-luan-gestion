/* Limpieza: este repo (dashboard) NO usa service worker.
   Si algún navegador alcanzó a registrar uno por error, aquí se borra solo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const clientes = await self.clients.matchAll({ type: 'window' });
    clientes.forEach(c => c.navigate(c.url));
  })());
});
