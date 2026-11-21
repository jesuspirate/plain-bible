// Counting how many use the app, without knowing who. Once a day the app
// says "hello" to the sync service, with no account, no id and no cookie,
// only a few yes/no answers (is this the device's first hello, its first
// this week or this month, and is it on a Home Screen), the app's language,
// which Bible it opens in, what kind of device it is (iPhone app, Mac app,
// Android app, Fedi, a browser), the hour and weekday of this first opening,
// whether it is still opening a week, a month or three months after its first
// hello, and how many prayers, chapters, shares and bookmarks happened on it
// since the last hello (see tally.ts). The service adds
// one to a few counters and keeps nothing else, not even the address it
// came from. That's enough to tell how many devices open the app each
// day, week and month, and how many are new.
import { savedLang } from '../i18n'
import { fromPlayStore, inMacApp, inStoreApp, installed, isAndroid, isIPhone } from './install'
import { inFedi } from './nostr'
import { tallies, untally, type Tally } from './tally'

const KEY = 'plain-bible:hello'
const SYNC_URL: string = (import.meta.env.VITE_SYNC_URL ?? '').replace(/\/$/, '')

/** The ISO week a day falls in, like "2026-W45" (weeks start on Monday). */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const y = t.getUTCFullYear()
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7)
  return `${y}-W${String(week).padStart(2, '0')}`
}

export interface Seen { day: string; week: string; month: string }
/** What this device keeps: the last hello, the day of its first hello under
 *  this count (devices from before it start the day they get it), and which
 *  "still opening after N days" it already told. */
export interface Kept extends Seen { first?: string; kept?: number[] }
export const periods = (d: Date): Seen => {
  const day = d.toISOString().slice(0, 10)
  return { day, week: isoWeek(d), month: day.slice(0, 7) }
}
export const KEEPS = [7, 30, 90]

/** The kind of device, in a word. */
export function platform(): string {
  if (inMacApp()) return 'mac'
  if (inStoreApp()) return 'ios'
  if (fromPlayStore()) return 'android'
  if (inFedi()) return 'fedi'
  return isIPhone() || isAndroid() ? 'phone' : 'computer'
}

export interface Extra { version?: string; platform?: string; hour?: number; weekday?: number; tally?: Tally }

/** What to tell the service today, or nothing if this device already said
 *  hello today. Also what to keep once it has been told. */
export function helloQuery(last: Kept | null, now: Seen, home: boolean, lang = 'en', extra: Extra = {}): { q: string; keep: Kept } | null {
  if (last?.day === now.day) return null
  const q = new URLSearchParams()
  if (!last) q.set('new', '1')
  if (last?.week !== now.week) q.set('week', '1')
  if (last?.month !== now.month) q.set('month', '1')
  if (home) q.set('home', '1')
  q.set('lang', lang)
  const first = last?.first ?? now.day
  if (!last?.first) q.set('start', '1')
  const age = Math.round((Date.parse(now.day) - Date.parse(first)) / 86_400_000)
  const kept = [...(last?.kept ?? [])]
  const due = KEEPS.filter(n => age >= n && !kept.includes(n))
  if (due.length) { q.set('kept', due.join(',')); kept.push(...due) }
  if (extra.version) q.set('bible', extra.version)
  if (extra.platform) q.set('on', extra.platform)
  if (extra.hour !== undefined) q.set('h', String(extra.hour))
  if (extra.weekday !== undefined) q.set('wd', String(extra.weekday))
  for (const [k, n] of Object.entries(extra.tally ?? {})) if (n > 0) q.set(k, String(n))
  return { q: q.toString(), keep: { ...now, first, ...(kept.length ? { kept } : {}) } }
}

const savedVersion = () => {
  try { const v = JSON.parse(localStorage.getItem('plain-bible:settings') || '{}').version; return typeof v === 'string' ? v : undefined } catch { return undefined }
}

/** Say hello, at most once a day, and only once the app has settled, so it
 *  never slows the start. Offline, it waits for another day it's online. */
export function hello() {
  if (!SYNC_URL || typeof navigator === 'undefined' || !navigator.onLine) return
  let last: Kept | null = null
  try { last = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return }
  const at = new Date(), now = periods(at), tally = tallies()
  const said = helloQuery(last, now, installed(), savedLang(), { version: savedVersion(), platform: platform(), hour: at.getHours(), weekday: at.getDay(), tally })
  if (said === null) return
  fetch(`${SYNC_URL}/hello?${said.q}`, { cache: 'no-store', credentials: 'omit', keepalive: true })
    .then(res => {
      if (!res.ok) return
      try { localStorage.setItem(KEY, JSON.stringify(said.keep)) } catch { /* private mode */ }
      untally(tally)
    })
    .catch(() => {})
}
