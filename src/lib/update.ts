// New versions of the app. The service worker downloads a new version in the
// background and keeps it waiting, so the page you're on never runs half old
// and half new. The update button shows for a minute: tap it to switch right
// away. If you don't, the app switches by itself after that minute, at the
// first quiet moment (never while you pray, write, listen or scroll), and
// comes back on the same verse. Leaving the app switches it too.
import { useEffect, useState } from 'preact/hooks'
import { withoutVerse } from './place'

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
  watch(r)
}

// How often an app left open on screen asks for a new version. The browser
// only asks by itself when a page loads, so without this a phone sitting on
// one chapter would never hear about an update.
const EVERY = 20 * 60 * 1000
// Never ask more than once a minute, however often you switch back and forth.
const GAP = 60 * 1000
let asked = 0

/** Quietly ask for a new version: when the app comes back on screen, when
 *  the connection comes back, and every so often while it stays open. Each
 *  ask is one small request for sw.js; nothing is downloaded unless a new
 *  version is really there. */
function watch(r: ServiceWorkerRegistration) {
  const ask = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return
    if (state === 'ready' || state === 'checking' || Date.now() - asked < GAP) return
    asked = Date.now()
    r.update().catch(() => {})
  }
  asked = Date.now() // registering just asked
  document.addEventListener('visibilitychange', ask)
  // Safari can bring a tab back from its page cache without a visibility change.
  addEventListener('pageshow', e => { if ((e as PageTransitionEvent).persisted) ask() })
  addEventListener('online', ask)
  // Timers stop while the phone sleeps; the visibility check covers waking up.
  setInterval(ask, EVERY)
}

/** How long the update button shows before the app updates by itself. */
export const COUNTDOWN = 60 * 1000
// How long you must have left the screen alone: no tap, scroll or key.
const STILL = 5 * 1000
let readyAt = 0
let lastTouch = 0

/** Things that keep the app from switching by itself while they last
 *  (a prayer being recorded, verses being picked, a sync on its way). */
const holds = new Set<string>()
export function holdUpdate(why: string, on: boolean) { on ? holds.add(why) : holds.delete(why) }

/** Whether switching now could lose or interrupt something: anything open
 *  over the word (a note, the prayer screen, Settings, search), typing,
 *  verses selected, reading aloud, or a tap or scroll a moment ago. */
export function busy(now = Date.now(), d: Pick<Document, 'querySelector' | 'activeElement'> = document) {
  if (holds.size || now - lastTouch < STILL) return true
  const a = d.activeElement as HTMLElement | null
  if (a && (a.matches?.('input, textarea, select') || a.isContentEditable)) return true
  return !!d.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], .sb-open, .selbar, .listen, .picked')
}

/** A new version is in. Switching right away could pull the page out from
 *  under you mid-sentence (search open, a note half typed), so the button
 *  shows for a minute first, and then it waits for a quiet moment. */
export function newVersionReady() {
  if (state === 'ready') return
  // You just asked for it: switch now.
  if (state === 'checking') { set('ready'); return applyUpdate() }
  readyAt = Date.now()
  set('ready')
  const away = () => { if (document.visibilityState === 'hidden') applyUpdate() }
  document.addEventListener('visibilitychange', away)
  const touched = () => { lastTouch = Date.now() }
  for (const e of ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchmove']) addEventListener(e, touched, { capture: true, passive: true })
  // Timers stop while the phone sleeps; checking every couple of seconds
  // picks up again as soon as it wakes.
  const tick = setInterval(() => {
    if (applying) return clearInterval(tick)
    if (document.visibilityState !== 'visible' || Date.now() - readyAt < COUNTDOWN || busy()) return
    clearInterval(tick)
    applyUpdate(true)
  }, 2000)
  away()
}

/** When the update button showed, for its countdown ring. */
export const readySince = () => readyAt

let applying = false
/** Switch to the new version now (you come back on the same verse).
 *  `quietly`: the app does it by itself, so the page fades out gently
 *  rather than blinking. */
export function applyUpdate(quietly = false) {
  if (applying) return
  applying = true
  // The address leads to the verse on top of the screen (the reader keeps
  // it saved), not to a verse you jumped to earlier.
  const hash = withoutVerse(location.hash)
  if (hash !== location.hash) history.replaceState(history.state, '', hash)
  if (quietly && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.documentElement.classList.add('updating')
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
  asked = Date.now()
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
