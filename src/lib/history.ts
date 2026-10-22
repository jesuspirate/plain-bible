// Reading history: the places you've jumped to, oldest first, with the
// verse you were on in each. Turning to the next or previous chapter
// updates the current place instead of adding one, so going back skips
// over chapters you simply read through and lands where you jumped from.
// Kept on this device only, like the place you were reading.
import { BOOK_INDEX } from './books'
import type { Place } from './place'

export interface Visit extends Place { t: number }
export interface Trail { items: Visit[]; i: number }

const KEY = 'plain-bible:history'
const MAX = 50

export function loadTrail(): Trail {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v && Array.isArray(v.items) && v.items.length) return { items: v.items, i: Math.min(Math.max(0, +v.i || 0), v.items.length - 1) }
  } catch { /* fall through */ }
  return { items: [], i: -1 }
}
function saveTrail(t: Trail) {
  try { localStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode */ }
  listeners.forEach(f => f(t))
}

const listeners = new Set<(t: Trail) => void>()
/** Called with the new trail whenever it changes. Returns an unsubscribe. */
export function onTrail(f: (t: Trail) => void) { listeners.add(f); return () => { listeners.delete(f) } }

const same = (a: Place, b: Place) => a.book === b.book && a.chapter === b.chapter
/** The next or previous chapter, also across the end of a book. */
export function adjacent(a: Place, b: Place) {
  if (a.book === b.book) return Math.abs(a.chapter - b.chapter) === 1
  const d = BOOK_INDEX[b.book] - BOOK_INDEX[a.book]
  return (d === 1 && b.chapter === 1) || (d === -1 && a.chapter === 1)
}

/** Where a back or forward step is headed, so arriving there moves the
 *  cursor instead of adding a new place. */
let stepping: number | undefined

/** Record arriving at a chapter. */
export function visit(p: Place, trail = loadTrail(), now = Date.now()): Trail {
  const { items } = trail
  let { i } = trail
  if (stepping !== undefined && items[stepping] && same(items[stepping], p)) {
    i = stepping; stepping = undefined
    return store({ items, i })
  }
  stepping = undefined
  const cur = items[i]
  if (cur && same(cur, p)) return trail
  if (cur && adjacent(cur, p)) {
    const next = items.slice()
    next[i] = { ...p, t: now }
    return store({ items: next, i })
  }
  // A jump: the place goes on the end (moved there if it was already listed).
  const next = items.filter(x => !same(x, p))
  next.push({ ...p, t: now })
  return store({ items: next.slice(-MAX), i: Math.min(next.length, MAX) - 1 })
}

/** Keep the verse you're on in the current place up to date. */
export function touch(p: Place, trail = loadTrail()): Trail {
  const cur = trail.items[trail.i]
  if (!cur || !same(cur, p) || cur.verse === p.verse) return trail
  const items = trail.items.slice()
  items[trail.i] = { ...cur, verse: p.verse }
  return store({ items, i: trail.i })
}

/** The place one step back (-1) or forward (1), and remember that's where
 *  we're going. */
export function step(dir: 1 | -1, trail = loadTrail()): Visit | undefined {
  const to = trail.i + dir
  if (!trail.items[to]) return undefined
  stepping = to
  return trail.items[to]
}

/** Jump straight to a listed place. */
export function stepTo(index: number, trail = loadTrail()): Visit | undefined {
  if (!trail.items[index]) return undefined
  stepping = index
  return trail.items[index]
}

export function clearTrail(keep?: Place) {
  store(keep ? { items: [{ ...keep, t: Date.now() }], i: 0 } : { items: [], i: -1 })
}

function store(t: Trail) { saveTrail(t); return t }
