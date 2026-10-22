// Where you were reading: the book, chapter and the verse at the top of the
// screen. Kept on the device only, so reopening the app (online or offline)
// lands on the same verse. It doesn't name a version, so it carries over when
// you switch versions or the app opens in your Default Bible.

export interface Place { book: string; chapter: number; verse: number }

const KEY = 'plain-bible:last'

/** Reads the saved place. Older versions saved just [book, chapter]. */
export function parsePlace(raw: string | null): Place | undefined {
  try {
    const v = JSON.parse(raw || 'null')
    if (Array.isArray(v) && typeof v[0] === 'string') return { book: v[0], chapter: Math.max(1, +v[1] || 1), verse: 1 }
    if (v && typeof v.book === 'string') return { book: v.book, chapter: Math.max(1, +v.chapter || 1), verse: Math.max(1, +v.verse || 1) }
  } catch { /* fall through */ }
  return undefined
}

export function loadPlace(): Place | undefined {
  try { return parsePlace(localStorage.getItem(KEY)) } catch { return undefined }
}

export function savePlace(p: Place) {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* private mode */ }
}

/** A reader address without its "?v=" verse, e.g. before a reload, so the page
 *  comes back where you scrolled to rather than on the verse you jumped to. */
export function withoutVerse(hash: string) {
  return hash.replace(/([?&])(?:v|at)=\d+(?=&|$)&?/g, '$1').replace(/[?&]$/, '')
}
