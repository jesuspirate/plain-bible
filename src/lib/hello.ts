// Counting how many use the app, without knowing who. Once a day the app
// says "hello" to the sync service, with no account, no id and no cookie,
// only a few yes/no answers (is this the device's first hello, its first
// this week or this month, and is it on a Home Screen) and the app's
// language. The service adds
// one to a few counters and keeps nothing else, not even the address it
// came from. That's enough to tell how many devices open the app each
// day, week and month, and how many are new.
import { installed } from './install'
import { savedLang } from '../i18n'

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
export const periods = (d: Date): Seen => {
  const day = d.toISOString().slice(0, 10)
  return { day, week: isoWeek(d), month: day.slice(0, 7) }
}

/** What to tell the service today, or nothing if this device already said
 *  hello today. */
export function helloQuery(last: Seen | null, now: Seen, home: boolean, lang = 'en'): string | null {
  if (last?.day === now.day) return null
  const q = new URLSearchParams()
  if (!last) q.set('new', '1')
  if (last?.week !== now.week) q.set('week', '1')
  if (last?.month !== now.month) q.set('month', '1')
  if (home) q.set('home', '1')
  q.set('lang', lang)
  return q.toString()
}

/** Say hello, at most once a day, and only once the app has settled, so it
 *  never slows the start. Offline, it waits for another day it's online. */
export function hello() {
  if (!SYNC_URL || typeof navigator === 'undefined' || !navigator.onLine) return
  let last: Seen | null = null
  try { last = JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return }
  const now = periods(new Date())
  const q = helloQuery(last, now, installed(), savedLang())
  if (q === null) return
  fetch(`${SYNC_URL}/hello?${q}`, { cache: 'no-store', credentials: 'omit', keepalive: true })
    .then(res => { if (res.ok) try { localStorage.setItem(KEY, JSON.stringify(now)) } catch { /* private mode */ } })
    .catch(() => {})
}
