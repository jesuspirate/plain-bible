// Notifications for circles, added to the app's service worker (see
// vite.config.ts). A message says only which circle has something new; the
// name comes from this phone's own copy (src/lib/push.ts). Quiet: no sound,
// no number on the icon, and one notification per circle at most.
/* eslint-env serviceworker */
const NAMES = new URL('push/circles.json', self.registration.scope).href

// { <circle id>: name, '': the notification's words in the app's language }
async function kept() {
  try {
    const res = await (await caches.open('quiet-bible-push')).match(NAMES)
    return res ? await res.json() : {}
  } catch { return {} }
}

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* not ours */ }
  const id = typeof data.c === 'string' ? data.c : ''
  event.waitUntil((async () => {
    const all = await kept()
    const name = id && typeof all[id] === 'string' ? all[id] : ''
    const words = all[''] || {}
    // An open app updates its dot right away.
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ t: 'circle-news' })
    // A phone must show something for every message, or it stops sending them.
    const title = name ? (words.title || 'Something new in {circle}').replace('{circle}', name) : words.other || 'Something new in your circle'
    await self.registration.showNotification(title, {
      tag: id ? `circle-${id}` : 'circle',
      icon: 'icon-192.png',
      silent: true,
      data: { c: id },
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const id = event.notification.data && event.notification.data.c
  const path = id ? `#/circles/${id}` : '#/circles'
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const app = open.find(c => new URL(c.url).pathname === new URL(self.registration.scope).pathname) || open[0]
    if (app) {
      await app.focus().catch(() => {})
      app.postMessage({ t: 'open-circle', c: id })
      return
    }
    await self.clients.openWindow(new URL(path, self.registration.scope).href)
  })())
})
