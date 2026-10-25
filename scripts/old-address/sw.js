// Replaces the app's service worker on the old address. Browsers that had the
// app open there check this file for updates; this version takes over at
// once, drops the cached app, unregisters itself and reloads its pages, which
// then reach index.html and go on to myquietbible.com.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k)
    await self.registration.unregister()
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {})
  })())
})
