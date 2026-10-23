// New versions of the app. The service worker downloads a new version in the
// background and keeps it waiting, so the page you're on never runs half old
// and half new. It switches over the next time you leave the app, or right
// away when you tap the update button.
import { useEffect, useState } from 'preact/hooks'

/** idle: nothing to say. checking: asked the site for a new version.
 *  ready: a new version is in, tap to use it. current: already the latest.
 *  offline: couldn't ask. */
export type UpdateState = 'idle' | 'checking' | 'ready' | 'current' | 'offline'

let state: UpdateState = 'idle'
let reg: ServiceWorkerRegistration | undefined
const subs = new Set<(s: UpdateState) => void>()
let settle = 0

function set(s: UpdateState) {
  state = s
  clearTimeout(settle)
  // "Up to date" and "offline" are only shown for a moment.
  if (s === 'current' || s === 'offline') settle = window.setTimeout(() => set('idle'), 2500)
  subs.forEach(f => f(s))
}

export function useUpdate() {
  const [s, setS] = useState(state)
  useEffect(() => { subs.add(setS); setS(state); return () => { subs.delete(setS) } }, [])
  return s
}

const controlled = () => !!navigator.serviceWorker?.controller

/** Called once the service worker is registered: notice a new version
 *  waiting now or arriving later. (On the very first visit there is nothing
 *  to switch from, so nothing to say.) */
export function registered(r: ServiceWorkerRegistration | undefined) {
  reg = r
  if (!r) return
  if (r.waiting && controlled()) newVersionReady()
  r.addEventListener('updatefound', () => {
    const w = r.installing
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && controlled()) newVersionReady() })
  })
}

/** A new version is in. Switching right away could pull the page out from
 *  under you mid-sentence (search open, a note half typed), so it waits
 *  until you switch away from the app, or tap the update button. */
export function newVersionReady() {
  if (state === 'ready') return
  // You just asked for it: switch now.
  if (state === 'checking') { set('ready'); return applyUpdate() }
  set('ready')
  const away = () => { if (document.visibilityState === 'hidden') applyUpdate() }
  document.addEventListener('visibilitychange', away)
  away()
}

let applying = false
/** Switch to the new version now (you come back on the same verse). */
export function applyUpdate() {
  if (applying) return
  applying = true
  const waiting = reg?.waiting
  if (waiting && navigator.serviceWorker) {
    // The waiting version takes over, then the page reloads onto it.
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
    setTimeout(() => location.reload(), 3000)
  } else location.reload()
}

/** Ask the site for a new version. If there is one, it is downloaded and the
 *  app switches to it; if not, say so for a moment. */
export async function checkForUpdate() {
  if (state === 'ready') return applyUpdate()
  if (state === 'checking') return
  if (!navigator.onLine) return set('offline')
  if (!reg) return set('current')
  set('checking')
  try {
    await reg.update()
    const incoming = reg.installing || reg.waiting
    if (!incoming) return set('current')
    // It downloads, then reports in through newVersionReady. Give up
    // waiting after a while (a weak connection).
    await new Promise<void>(done => {
      const t = setTimeout(done, 30000)
      const watch = () => { if (incoming.state !== 'installing') { clearTimeout(t); done() } }
      incoming.addEventListener('statechange', watch)
      watch()
    })
    if ((state as UpdateState) === 'checking') { if (reg.waiting) newVersionReady(); else set('idle') }
  } catch {
    set(navigator.onLine ? 'idle' : 'offline')
  }
}
