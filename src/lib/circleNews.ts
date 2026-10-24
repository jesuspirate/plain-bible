// Something new in your circles: a quiet dot, never a count or a sound.
// The server says only when someone else last shared, replied, or prayed
// with something of yours in each circle (it never knows what); this device
// remembers when you last looked. Small, and in the main bundle, so the 🙏
// button can show the dot without loading circles.
import { useEffect, useState } from 'preact/hooks'
import { api, loadAccount, SYNC_URL } from './sync'

const SEEN = 'plain-bible:circle-seen'
const LATEST = 'plain-bible:circle-latest'
export const NEWS_EVENT = 'plain-bible:circle-news'

type Times = Record<string, number>
const read = (k: string): Times => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {} } catch { return {} } }
const write = (k: string, v: Times) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }
const changed = () => dispatchEvent(new Event(NEWS_EVENT))

/** When this circle was last looked at here. Never heard of: as if just now,
 *  so nothing that came before shows as new. */
export const seenAt = (id: string) => read(SEEN)[id] ?? Infinity
/** Whether someone else did something in this circle since you last looked. */
export const hasNews = (id: string) => { const l = read(LATEST)[id]; return !!l && l > (read(SEEN)[id] ?? l) }
/** How many of your circles have something new. */
export const circlesWithNews = () => Object.keys(read(LATEST)).filter(hasNews).length

/** What the server said about each circle. A circle seen here for the first
 *  time starts as read, so joining (or a new device) doesn't light up
 *  everything that came before. Circles you've left are forgotten. */
export function noteLatest(list: { id: string; latest?: number | null }[]) {
  const seen = read(SEEN), latest: Times = {}
  for (const c of list) {
    const at = Number(c.latest) || 0
    latest[c.id] = at
    if (!(c.id in seen)) seen[c.id] = at
  }
  for (const id of Object.keys(seen)) if (!(id in latest)) delete seen[id]
  write(SEEN, seen)
  write(LATEST, latest)
  changed()
}

/** You've looked at this circle, up to `at` (a server time). `fresh`: what
 *  you saw just came from the server, so whatever it said before counts as
 *  seen too (a prayer still uploading, say). */
export function markSeen(id: string, at: number, fresh = false) {
  const seen = read(SEEN)
  const upTo = Math.max(at, fresh ? read(LATEST)[id] ?? 0 : 0)
  if ((seen[id] ?? 0) >= upTo) return
  seen[id] = upTo
  write(SEEN, seen)
  changed()
}

let last = 0
/** Ask the server, at most once a minute. Quiet when offline or signed out. */
export async function checkCircleNews(force = false) {
  const a = loadAccount()
  if (!SYNC_URL || !a || navigator.onLine === false) return
  if (!force && Date.now() - last < 60_000) return
  last = Date.now()
  try {
    const { circles } = await api<{ circles: { id: string; latest?: number | null }[] }>('/circles', { token: a.token })
    noteLatest(circles)
  } catch { last = 0 }
}

/** Re-renders the component when circle news changes, here or in another tab. */
export function useCircleNews() {
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => tick(n => n + 1)
    addEventListener(NEWS_EVENT, on)
    addEventListener('storage', on)
    return () => { removeEventListener(NEWS_EVENT, on); removeEventListener('storage', on) }
  }, [])
}
