// Notifications for circles: "Something new in Family", nothing more. Each
// device turns them on circle by circle. The server only knows which circle
// has news; this device keeps the circles' names where the service worker
// can read them (public/push-sw.js), so the name never leaves the phone.
// Loaded with circles, never at startup.
import { api, loadAccount, SYNC_URL, SyncError } from './sync'
import type { CircleInfo } from './circles'
import { t } from '../i18n'

const ON = 'plain-bible:push-circles'
const NAMES_CACHE = 'quiet-bible-push', NAMES_URL = 'push/circles.json'

const readOn = (): string[] => { try { return JSON.parse(localStorage.getItem(ON) || '[]') } catch { return [] } }
const writeOn = (ids: string[]) => { try { ids.length ? localStorage.setItem(ON, JSON.stringify(ids)) : localStorage.removeItem(ON) } catch { /* ignore */ } }

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

/** ok: can be turned on. install: an iPhone in Safari, which only allows
 *  notifications for apps on the Home Screen. old: an iPhone before iOS
 *  16.4. blocked: said no before (the phone's settings can undo that).
 *  no: this browser can't. */
export function pushSupport(): 'ok' | 'install' | 'old' | 'blocked' | 'no' {
  const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!can) return !isIOS() ? 'no' : standalone() ? 'old' : 'install'
  return Notification.permission === 'denied' ? 'blocked' : 'ok'
}
export const blockedHelp = () => isIOS()
  ? t('Notifications are turned off for My Quiet Bible. To allow them: iPhone Settings → Notifications → My Quiet Bible.')
  : t('Notifications are blocked for My Quiet Bible. To allow them: tap the lock or ⋮ by the address, then Notifications. On an installed app: hold its icon → App info → Notifications.')

/** Whether this device hears about this circle. */
export const pushOn = (circle: string) => readOn().includes(circle) && typeof Notification !== 'undefined' && Notification.permission === 'granted'

let key: Promise<string | null> | undefined
/** The server's key, asked for ahead of the tap, so the tap goes straight to the question. */
export const prepareKey = () => key ??= api<{ key: string | null }>('/push/key').then(r => r.key, e => { key = undefined; throw e })

const subJson = (s: PushSubscription) => s.toJSON()
function token() {
  const a = loadAccount()
  if (!SYNC_URL || !a) throw new SyncError('Sign in first, under Settings → Account.')
  return a.token
}

async function subscription(ask: boolean) {
  const reg = await navigator.serviceWorker.ready
  const had = await reg.pushManager.getSubscription()
  if (had || !ask) return had
  const k = await prepareKey()
  if (!k) throw new SyncError('Notifications aren’t set up yet. Try again later.')
  const raw = Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((k.length + 3) % 4)), c => c.charCodeAt(0))
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw })
}

/** Turn this circle's notifications on. Called straight from the tap: the
 *  phone asks "Allow notifications?" first, which iPhones only allow in a tap. */
export async function turnOn(circle: string) {
  const asked = Notification.requestPermission()
  if (await asked !== 'granted') throw new SyncError(Notification.permission === 'denied' ? blockedHelp() : t('Notifications weren’t allowed. Tap again to be asked once more.'))
  const sub = await subscription(true)
  if (!sub) throw new SyncError('This phone couldn’t turn notifications on. Try again in a moment.')
  await api(`/push/circles/${circle}`, { method: 'PUT', token: token(), body: { sub: subJson(sub) } })
  writeOn([...readOn().filter(x => x !== circle), circle])
}

export async function turnOff(circle: string) {
  const sub = await subscription(false)
  if (sub) await api(`/push/circles/${circle}`, { method: 'DELETE', token: token(), body: { sub: subJson(sub) } })
  const left = readOn().filter(x => x !== circle)
  writeOn(left)
  // Nothing left to hear about: let the phone forget this app's push address too.
  if (!left.length) await sub?.unsubscribe().catch(() => {})
}

/** A phone can quietly change its push address; tell the server again
 *  (once a day at most) so notifications keep arriving. */
export async function refreshPush() {
  const on = readOn()
  if (!on.length || pushSupport() !== 'ok' || Notification.permission !== 'granted' || !loadAccount() || navigator.onLine === false) return
  const last = 'plain-bible:push-checked'
  try { if (Date.now() - +(localStorage.getItem(last) || 0) < 86_400_000) return; localStorage.setItem(last, String(Date.now())) } catch { /* ignore */ }
  const sub = await subscription(true).catch(() => null)
  if (!sub) return
  for (const c of on) await api(`/push/circles/${c}`, { method: 'PUT', token: token(), body: { sub: subJson(sub) } }).catch((e: SyncError) => {
    // Not in that circle any more.
    if (e.status === 404) writeOn(readOn().filter(x => x !== c))
  })
}

/** The circles' names, for the service worker to put in the notification. */
export async function keepNames(circles: CircleInfo[]) {
  if (typeof caches === 'undefined') return
  // With the notification's words in the app's language.
  const names = { ...Object.fromEntries(circles.map(c => [c.id, c.name])), '': { title: t('Something new in {circle}'), other: t('Something new in your circle') } }
  const c = await caches.open(NAMES_CACHE)
  await c.put(new URL(NAMES_URL, location.href).href, new Response(JSON.stringify(names), { headers: { 'Content-Type': 'application/json' } }))
}

/** Left the circle (the server already stopped its notifications). */
export const forget = (circle: string) => writeOn(readOn().filter(x => x !== circle))

/** Looking at the circle: its notification has been read. */
export async function clearNotifications(circle: string) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return
  const reg = await navigator.serviceWorker.ready
  for (const n of await reg.getNotifications({ tag: `circle-${circle}` })) n.close()
}
