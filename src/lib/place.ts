// Where you were reading: the book, chapter and the verse at the top of the
// screen. Kept on the device, so reopening the app (online or offline) lands
// on the same verse. Opening never uses its version, so the place carries
// over when you switch versions or the app opens in your Bible.
//
// Signed in, the newest place of all your devices also travels with the
// account (see sync.ts), so another device can offer "Continue at Romans 8".
// It only ever offers: no device moves by itself.

export interface Place {
  book: string; chapter: number; verse: number
  /** the version it was read in, and when you last moved there yourself */
  version?: string; t?: number
}

const KEY = 'plain-bible:last'
/** Sent when the place you read changes, or another device's place arrives. */
export const PLACE_EVENT = 'plain-bible:place'
const changed = () => { try { dispatchEvent(new Event(PLACE_EVENT)) } catch { /* no window */ } }

/** Reads the saved place. Older versions saved just [book, chapter]. */
export function parsePlace(raw: string | null): Place | undefined {
  try {
    const v = JSON.parse(raw || 'null')
    if (Array.isArray(v) && typeof v[0] === 'string') return { book: v[0], chapter: Math.max(1, +v[1] || 1), verse: 1 }
    if (v && typeof v.book === 'string') {
      const p: Place = { book: v.book, chapter: Math.max(1, +v.chapter || 1), verse: Math.max(1, +v.verse || 1) }
      if (typeof v.version === 'string') p.version = v.version
      if (typeof v.t === 'number') p.t = v.t
      return p
    }
  } catch { /* fall through */ }
  return undefined
}

export function loadPlace(): Place | undefined {
  try { return parsePlace(localStorage.getItem(KEY)) } catch { return undefined }
}

// The page settling as the app opens also "moves" (to the verse you left, give
// or take one). Only a place reached after you touched the app counts as you
// reading here, so just opening a device never makes its old place the newest.
let touched = false
if (typeof addEventListener !== 'undefined') {
  const on = () => { touched = true; for (const e of EVENTS) removeEventListener(e, on, true) }
  const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']
  for (const e of EVENTS) addEventListener(e, on, { capture: true, passive: true })
}

/** The place to save: stamped now if you moved, with its old time if not. */
export function stamp(p: Place, last: Place | undefined, moved: boolean, now = Date.now()): Place {
  const same = !!last && last.book === p.book && last.chapter === p.chapter && last.verse === p.verse
  const t = same || !moved ? last?.t : now
  const version = p.version ?? (last && last.book === p.book && last.chapter === p.chapter ? last.version : undefined)
  return { book: p.book, chapter: p.chapter, verse: p.verse, ...(version ? { version } : {}), ...(t ? { t } : {}) }
}

export function savePlace(p: Place) {
  const last = loadPlace(), next = stamp(p, last, touched)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode */ }
  if (next.t !== last?.t) changed()
}

// ---- the place that travels with the account -------------------------------

/** What kind of device a place was read on, named in your language where shown. */
export type Device = 'iphone' | 'ipad' | 'mac' | 'android' | 'computer'
/** The search being stepped through (searchbar.tsx): its words, the Bible
 *  searched, the versions picked, and which result you were on. */
export interface PlaceSearch { q: string; base: string; picked?: string[]; at: number }
export interface SyncedPlace extends Place { t: number; dev: string; on: Device; s?: PlaceSearch }

export function deviceKind(ua = navigator.userAgent, touch = navigator.maxTouchPoints ?? 0): Device {
  if (/iPhone|iPod/.test(ua)) return 'iphone'
  // iPads ask for the desktop site and call themselves a Mac.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return 'ipad'
  if (/Android/.test(ua)) return 'android'
  return /Macintosh/.test(ua) ? 'mac' : 'computer'
}

const DEVICE = 'plain-bible:device', FROM = 'plain-bible:place-from', SEEN = 'plain-bible:place-seen'
export const SEARCH_TRAIL = 'plain-bible:search-trail'
/** A random name for this device, only to tell its own place from another's. */
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE)
    if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE, id) }
    return id
  } catch { return 'here' }
}

const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max
/** A place as it came from the account, or nothing if it isn't one. */
export function parseSynced(v: any): SyncedPlace | undefined {
  if (!v || !str(v.book, 12) || typeof v.t !== 'number' || !(v.t > 0) || !str(v.dev, 40)) return undefined
  const p: SyncedPlace = {
    book: v.book, chapter: Math.max(1, Math.floor(+v.chapter) || 1), verse: Math.max(1, Math.floor(+v.verse) || 1), t: v.t, dev: v.dev,
    on: ['iphone', 'ipad', 'mac', 'android', 'computer'].includes(v.on) ? v.on : 'computer',
  }
  if (str(v.version, 40)) p.version = v.version
  const s = v.s
  if (s && str(s.q, 200) && str(s.base, 40) && Number.isInteger(s.at) && s.at >= 0) {
    p.s = { q: s.q, base: s.base, at: s.at }
    if (Array.isArray(s.picked) && s.picked.length <= 30 && s.picked.every((x: unknown) => str(x, 40))) p.s.picked = s.picked
  }
  return p
}

/** The newer of two places; `a` on a tie. */
export function newerPlace(a: SyncedPlace | undefined, b: SyncedPlace | undefined) {
  return b && (!a || b.t > a.t) ? b : a
}

const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }

/** Where you last read on this device, as it goes to the account: nothing
 *  until you've moved here since this was added. */
export function ownPlace(): SyncedPlace | undefined {
  const p = loadPlace()
  if (!p?.t) return undefined
  const out: SyncedPlace = { book: p.book, chapter: p.chapter, verse: p.verse, t: p.t, dev: deviceId(), on: deviceKind() }
  if (p.version) out.version = p.version
  const s = read(SEARCH_TRAIL)
  if (s && str(s.q, 200) && str(s.base, 40) && Number.isInteger(s.at)) out.s = parseSynced({ ...out, s })?.s
  return out
}
/** The newest place known here: this device's, or another's that came with the last sync. */
export const latestPlace = () => newerPlace(ownPlace(), parseSynced(read(FROM)))

/** After a sync: keep the account's place if another device read later than this one. */
export function takePlace(remote: unknown) {
  const p = parseSynced(remote), own = ownPlace()
  const from = p && p.dev !== deviceId() && p.t > (own?.t ?? 0) ? p : undefined
  try {
    const was = localStorage.getItem(FROM), now = from ? JSON.stringify(from) : null
    if (was === now) return
    now ? localStorage.setItem(FROM, now) : localStorage.removeItem(FROM)
  } catch { return }
  changed()
}

/** Whether to offer `from` to someone whose own place is `own`: only a later
 *  place, not one already answered, and not the chapter they're already on
 *  (unless it brings a search along). */
export function worthOffering(from: SyncedPlace | undefined, own: Place | undefined, seen: number) {
  if (!from || from.t <= (own?.t ?? 0) || from.t <= seen) return false
  return !!from.s || !own || own.book !== from.book || own.chapter !== from.chapter
}
/** Another device's later place to offer here, if any. */
export function placeOffer(): SyncedPlace | undefined {
  const from = parseSynced(read(FROM))
  return worthOffering(from, loadPlace(), placeOffer.answered()) ? from : undefined
}
/** The time of the last offer answered. */
placeOffer.answered = () => +read(SEEN) || 0
/** The offer was answered (taken or closed): it isn't made again. */
export function answerOffer(p: SyncedPlace) {
  try { localStorage.setItem(SEEN, String(p.t)) } catch { /* ignore */ }
  changed()
}

/** A reader address without its "?v=" verse, e.g. before a reload, so the page
 *  comes back where you scrolled to rather than on the verse you jumped to. */
export function withoutVerse(hash: string) {
  return hash.replace(/([?&])(?:v|at)=\d+(?=&|$)&?/g, '$1').replace(/[?&]$/, '')
}

/** Pick up the search that came with a place: the strip with ‹ › shows on
 *  the same result (searchbar.tsx listens). */
export const SEARCH_TRAIL_EVENT = 'plain-bible:search-trail'
export function continueSearch(s: PlaceSearch) {
  try { localStorage.setItem(SEARCH_TRAIL, JSON.stringify({ ...s, scroll: 0, scrollAt: -1, shown: s.at + 1 })) } catch { /* ignore */ }
  dispatchEvent(new Event(SEARCH_TRAIL_EVENT))
}
