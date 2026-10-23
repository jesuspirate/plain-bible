// Reading history: where you are, plus the last few places you jumped from,
// each with the verse you were on. Going back to a place is just another
// jump, so pressing back twice bounces you between two places (like
// following a sermon). Turning to the next or previous chapter updates the
// current place instead of adding one. Kept on this device only.
import { BOOK_INDEX } from './books'
import type { Place } from './place'

export interface Visit extends Place { t: number }
/** Oldest first; the last item is where you are. */
export interface Trail { items: Visit[] }

const KEY = 'plain-bible:history'
/** Where you are and the 3 places before it. More than that is clutter. */
const MAX = 4

export function loadTrail(): Trail {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    // Older versions kept a cursor `i` into a longer list; the place you
    // were on goes last.
    if (v && Array.isArray(v.items) && v.items.length) {
      const items: Visit[] = v.items.slice()
      if (typeof v.i === 'number' && items[v.i]) items.push(items.splice(v.i, 1)[0])
      return { items: items.slice(-MAX) }
    }
  } catch { /* fall through */ }
  return { items: [] }
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

/** Record arriving at a chapter. */
export function visit(p: Place, trail = loadTrail(), now = Date.now()): Trail {
  const items = trail.items.slice()
  const cur = items[items.length - 1]
  if (cur && same(cur, p)) return trail
  if (cur && adjacent(cur, p)) {
    items[items.length - 1] = { ...p, t: now }
    return store({ items })
  }
  // A jump: the place goes last (moved there if it was already listed).
  const next = items.filter(x => !same(x, p))
  next.push({ ...p, t: now })
  return store({ items: next.slice(-MAX) })
}

/** Keep the verse you're on in the current place up to date. */
export function touch(p: Place, trail = loadTrail()): Trail {
  const items = trail.items.slice(), cur = items[items.length - 1]
  if (!cur || !same(cur, p) || cur.verse === p.verse) return trail
  items[items.length - 1] = { ...cur, verse: p.verse }
  return store({ items })
}

/** The places you can go back to, most recent first. */
export function previous(trail: Trail): Visit[] {
  return trail.items.slice(0, -1).reverse()
}

function store(t: Trail) { saveTrail(t); return t }
