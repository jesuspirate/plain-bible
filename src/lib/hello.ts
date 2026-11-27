// Counting how many use the app, without knowing who. Once a day the app
// says "hello" to the sync service, with no account, no id and no cookie,
// only a few yes/no answers (is this the device's first hello, its first
// this week or this month, and is it on a Home Screen), the app's language,
// which Bible it opens in, what kind of device it is (iPhone app, Mac app,
// Android app, Fedi, a browser), the hour and weekday of this first opening,
// whether it is still opening a week, a month or three months after its first
// hello, and how many prayers, chapters, shares and bookmarks happened on it
// since the last hello (see tally.ts), and whether anything was listened to,
// with what kind of voice, in which Bible and language (see heard.ts). The service adds
// one to a few counters and keeps nothing else, not even the address it
// came from (on the prayer map, below, only its country). That's enough to tell how many devices open the app each
// day, week and month, and how many are new.
//
// The prayer map (src/world.tsx): when this device prayed since the last
// hello, and "Count my prayers on the map" is ticked, the hello also says
// "pw=1", at most once in any 7 days. The service then adds one to that
// day's count for the country the request comes from (Cloudflare's guess
// from the address, which isn't kept). Summed over 7 days, that counts each
// praying device once per country.
import { savedLang } from '../i18n'
import { fromMicrosoftStore, fromPlayStore, inMacApp, inStoreApp, installed, isAndroid, isIPhone } from './install'
import { inFedi } from './nostr'
import { tallies, untally, type Tally } from './tally'
import { HEARD_KINDS, heardSince, unheard, type Heard } from './heard'

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
export interface Kept extends Seen { first?: string; kept?: number[]; heardWeek?: string; heardMonth?: string; mapDay?: string }
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
  if (fromMicrosoftStore()) return 'windows'
  if (inFedi()) return 'fedi'
  return isIPhone() || isAndroid() ? 'phone' : 'computer'
}

export interface Extra { version?: string; platform?: string; hour?: number; weekday?: number; tally?: Tally; heard?: Heard; map?: boolean }

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
  // Listened since the last hello: what, and whether it's the first time
  // this week and this month, so listeners can be counted, not only days.
  let { heardWeek, heardMonth } = last ?? {}
  if (extra.heard?.m?.length) {
    for (const k of HEARD_KINDS) if (extra.heard[k]?.length) q.set(`a${k}`, extra.heard[k]!.join(','))
    if (heardWeek !== now.week) { q.set('aw', '1'); heardWeek = now.week }
    if (heardMonth !== now.month) { q.set('amo', '1'); heardMonth = now.month }
  }
  // Prayed, and counting on the prayer map: once in any 7 days.
  let mapDay = last?.mapDay
  if (extra.map && (extra.tally?.pr ?? 0) > 0 && (!mapDay || Date.parse(now.day) - Date.parse(mapDay) >= 7 * 86_400_000)) { q.set('pw', '1'); mapDay = now.day }
  return { q: q.toString(), keep: { ...now, first, ...(kept.length ? { kept } : {}), ...(heardWeek ? { heardWeek } : {}), ...(heardMonth ? { heardMonth } : {}), ...(mapDay ? { mapDay } : {}) } }
}

const saved = () => { try { return JSON.parse(localStorage.getItem('plain-bible:settings') || '{}') } catch { return {} } }
const savedVersion = () => { const v = saved().version; return typeof v === 'string' ? v : undefined }
/** "Count my prayers on the map": on unless unticked. */
const mapOn = () => saved().worldMap !== false

/** Say hello, at most once a day, and only once the app has settled, so it
 *  never slows the start. Offline, it waits for another day it's online. */
export function hello() {
  if (!SYNC_URL || typeof navigator === 'undefined' || !navigator.onLine) return
  let last: Kept | null = null
  try { last = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return }
  const at = new Date(), now = periods(at), tally = tallies(), heard = heardSince()
  const said = helloQuery(last, now, installed(), savedLang(), { version: savedVersion(), platform: platform(), hour: at.getHours(), weekday: at.getDay(), tally, heard, map: mapOn() })
  if (said === null) return
  fetch(`${SYNC_URL}/hello?${said.q}`, { cache: 'no-store', credentials: 'omit', keepalive: true })
    .then(res => {
      if (!res.ok) return
      try { localStorage.setItem(KEY, JSON.stringify(said.keep)) } catch { /* private mode */ }
      untally(tally)
      unheard(heard)
    })
    .catch(() => {})
}
