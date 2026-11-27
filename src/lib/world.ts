// The prayer map's countries: the ones where at least 5 devices prayed in the
// last 7 days (the service's /world, counted from the daily hello, see
// hello.ts). Only two-letter country codes, the same for everyone, never how
// many in each. Kept on this device, so after Amen the line shows at once,
// offline too, and asked again at most every few hours.
import { SYNC_URL } from './sync'

const KEY = 'plain-bible:world'
const FRESH = 6 * 3_600_000

export interface World { c: string[]; at: number }

export function savedWorld(): World | undefined {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || 'null')
    return w && Array.isArray(w.c) && typeof w.at === 'number' ? { c: w.c.filter((x: unknown) => typeof x === 'string' && /^[A-Z]{2}$/.test(x)), at: w.at } : undefined
  } catch { return undefined }
}

let asking: Promise<World | undefined> | undefined
/** The lit countries: the kept ones, asked again when they're a few hours
 *  old and the device is online. Never throws. */
export function loadWorld(now = Date.now()): Promise<World | undefined> {
  const kept = savedWorld()
  if (!SYNC_URL || (kept && now - kept.at < FRESH) || (typeof navigator !== 'undefined' && !navigator.onLine)) return Promise.resolve(kept)
  return asking ??= fetch(`${SYNC_URL}/world`, { credentials: 'omit' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then((r: { c?: unknown }) => {
      const w: World = { c: Array.isArray(r.c) ? r.c.filter(x => typeof x === 'string' && /^[A-Z]{2}$/.test(x)) : [], at: now }
      try { localStorage.setItem(KEY, JSON.stringify(w)) } catch { /* private mode */ }
      return w
    })
    .catch(() => kept)
    .finally(() => { asking = undefined })
}
