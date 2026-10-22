// Personal highlights and bookmarks. Marks belong to a verse, not to a
// translation, so a highlight shows in every version you read.
import { BOOK_INDEX, findBook } from './books'

export interface Mark {
  /** highlight color, e.g. "#fff193" */
  c?: string
  /** bookmarked */
  b?: 1
  /** version it was made in (informational) */
  v?: string
  /** last changed, ms since epoch */
  t: number
}
/** key: "John.3.16" */
export type Marks = Record<string, Mark>

export const PALETTE: { color: string; name: string }[] = [
  { color: '#fff193', name: 'Yellow' },
  { color: '#b3e487', name: 'Green' },
  { color: '#cae1fe', name: 'Blue' },
  { color: '#80cbc4', name: 'Teal' },
  { color: '#dac6ff', name: 'Purple' },
  { color: '#ffc9e4', name: 'Pink' },
  { color: '#ffc595', name: 'Orange' },
  { color: '#ffadaf', name: 'Red' },
]

export const markKey = (book: string, chapter: number, verse: number) => `${book}.${chapter}.${verse}`
export function parseKey(key: string) {
  const [book, c, v] = key.split('.')
  return { book, chapter: +c, verse: +v }
}
export function compareKeys(a: string, b: string) {
  const x = parseKey(a), y = parseKey(b)
  return BOOK_INDEX[x.book] - BOOK_INDEX[y.book] || x.chapter - y.chapter || x.verse - y.verse
}

const KEY = 'plain-bible:marks'
export function loadMarks(): Marks {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
export function saveMarks(m: Marks) {
  try { localStorage.setItem(KEY, JSON.stringify(m)) } catch { /* storage full or blocked */ }
}

// ---------------------------------------------------------------------------
// Importing

export interface ImportItem { book: string; chapter: number; verse: number; color?: string; bookmark?: boolean; version?: string }
export interface ImportResult { items: ImportItem[]; skipped: string[] }

const LINE = /^(.+?)\s+(\d+)\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?(?:\s+([A-Za-z0-9-]{2,12}))?(?:\s+(#[0-9a-fA-F]{6}))?$/

/** One reference per line, as exported by many Bible apps:
 *  "Genèse 2:5 LBS21  #b3e487" (highlight) or "Genesis 22:2" (bookmark). */
export function parseRefList(text: string, kind: 'highlight' | 'bookmark' | 'auto' = 'auto'): ImportResult {
  const items: ImportItem[] = [], skipped: string[] = []
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const m = line.match(LINE)
    const book = m && findBook(m[1])
    if (!m || !book) { skipped.push(line); continue }
    const from = +m[3], to = m[4] ? +m[4] : from
    for (let v = from; v <= Math.min(to, from + 200); v++) {
      const item: ImportItem = { book, chapter: +m[2], verse: v }
      if (m[5]) item.version = m[5]
      if (m[6]) item.color = m[6].toLowerCase()
      if (kind === 'bookmark' || (kind === 'auto' && !m[6])) item.bookmark = true
      items.push(item)
    }
  }
  return { items, skipped }
}

/** Visible text of an HTML export, one line per <br>, <p>, <li> or <div>. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|li|div|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
}

/** Merge imported items into marks. Existing marks keep their other fields. */
export function mergeImport(marks: Marks, items: ImportItem[], now = Date.now()): { marks: Marks; highlights: number; bookmarks: number } {
  const out = { ...marks }
  let highlights = 0, bookmarks = 0
  for (const it of items) {
    const k = markKey(it.book, it.chapter, it.verse)
    const m: Mark = { ...out[k], t: now }
    if (it.color) { m.c = it.color; highlights++; if (it.version) m.v = it.version }
    if (it.bookmark) { m.b = 1; bookmarks++ }
    out[k] = m
  }
  return { marks: out, highlights, bookmarks }
}

/** Our own backup format. */
export interface Backup { app: 'plain-bible'; version: 1; exported: string; marks: Marks; settings?: unknown }
export function isBackup(x: unknown): x is Backup {
  return !!x && typeof x === 'object' && (x as Backup).app === 'plain-bible' && typeof (x as Backup).marks === 'object'
}
