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
  /** your note on this verse */
  n?: string
  /** the verses the note is about, when it covers more than this one
   *  (sorted, includes this verse). The note lives on the first of them. */
  nv?: number[]
  /** when the note last changed. Kept after a note is deleted, so the
   *  deletion syncs; notes and highlights on one verse merge separately. */
  nt?: number
  /** last changed, ms since epoch. A mark with no color, bookmark or note
   *  records a removal, so that it syncs to other devices. */
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

/** The colour last picked, for double-tap highlighting. */
const LAST_COLOR = 'plain-bible:last-color'
export function lastColor() {
  try { return localStorage.getItem(LAST_COLOR) || PALETTE[0].color } catch { return PALETTE[0].color }
}
export function rememberColor(c: string) {
  try { localStorage.setItem(LAST_COLOR, c) } catch { /* private mode */ }
}

export const markKey = (book: string, chapter: number, verse: number) => `${book}.${chapter}.${verse}`
export function parseKey(key: string) {
  const [book, c, v] = key.split('.')
  return { book, chapter: +c, verse: +v }
}
export function compareKeys(a: string, b: string) {
  const x = parseKey(a), y = parseKey(b)
  return BOOK_INDEX[x.book] - BOOK_INDEX[y.book] || x.chapter - y.chapter || x.verse - y.verse
}

/** Whether a mark holds anything to show (not just a removal record). */
export const hasContent = (m: Mark | undefined) => !!(m && (m.c || m.b || m.n))

/** A mark with nothing left becomes a bare removal record. */
export function tidy(m: Mark): Mark {
  if (hasContent(m)) return m
  return m.nt ? { t: m.t, nt: m.nt } : { t: m.t }
}

/** Merge two versions of one verse's mark: the newer one wins, except
 *  that the note keeps whichever note was edited last. */
export function mergeMark(a: Mark | undefined, b: Mark | undefined): Mark | undefined {
  if (!a || !b) return a ?? b
  const out: Mark = { ...((b.t ?? 0) > (a.t ?? 0) ? b : a) }
  // Copied: when both notes are the same age the note comes from `out`,
  // which is cleared next.
  const note = { ...((b.nt ?? 0) > (a.nt ?? 0) ? b : (a.nt ?? 0) > (b.nt ?? 0) ? a : out) }
  delete out.n; delete out.nt; delete out.nv
  if (note.n) out.n = note.n
  if (note.n && note.nv) out.nv = note.nv
  if (note.nt) out.nt = note.nt
  return tidy(out)
}

/** Set or clear (empty text) the note on one verse, or on a passage:
 *  `verses` are all the verses it is about; the note is kept on `key`. */
export function setNote(marks: Marks, key: string, text: string, now = Date.now(), verses?: number[]): Marks {
  const m: Mark = { ...marks[key], t: now, nt: now }
  const n = text.trim()
  delete m.nv
  if (n) { m.n = n; if (verses && verses.length > 1) m.nv = verses } else delete m.n
  return { ...marks, [key]: tidy(m) }
}

/** The note in this chapter that covers verse `v`: its own, or a passage
 *  note that starts on an earlier verse. Returns the verse it lives on. */
export function noteCovering(marks: Marks, book: string, chapter: number, v: number): number | undefined {
  if (marks[markKey(book, chapter, v)]?.n) return v
  for (let s = v - 1; s >= Math.max(1, v - 200); s--) {
    const m = marks[markKey(book, chapter, s)]
    if (m?.n && m.nv?.includes(v)) return s
  }
  return undefined
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

export interface ImportItem { book: string; chapter: number; verse: number; color?: string; bookmark?: boolean; version?: string; note?: string }
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

const REF = /^(.+?)\s+(\d+)\s*[:.]\s*(\d+)(?:\s*[-–]\s*\d+)?(?:\s+[A-Za-z0-9-]{2,12})?$/

/** A notes export: entries separated by a rule or a heading, each with a
 *  reference line ("John 3:16 NIV") and the note's text. A quoted verse
 *  (blockquote) and the date line are left out. The note goes on the first
 *  verse of a range. */
export function parseNotes(html: string): ImportResult {
  const items: ImportItem[] = [], skipped: string[] = []
  const body = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '').replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n')
  for (const chunk of body.split(/<hr\s*\/?>|<h[1-4][^>]*>/i)) {
    const lines = htmlToText(chunk).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const at = lines.findIndex(l => REF.test(l) && findBook(l.match(REF)![1]))
    if (at < 0) { if (lines.length) skipped.push(lines[0]); continue }
    const m = lines[at].match(REF)!
    // Anything before the reference is a title; keep it as the first line.
    const text = [...lines.slice(0, at), ...lines.slice(at + 1)]
      .filter(l => !/^\d{4}-\d\d-\d\d|^(created|updated|date)\b/i.test(l)).join('\n').trim()
    if (!text) { skipped.push(lines[at]); continue }
    items.push({ book: findBook(m[1])!, chapter: +m[2], verse: +m[3], note: text })
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
export function mergeImport(marks: Marks, items: ImportItem[], now = Date.now()): { marks: Marks; highlights: number; bookmarks: number; notes: number } {
  const out = { ...marks }
  let highlights = 0, bookmarks = 0, notes = 0
  for (const it of items) {
    const k = markKey(it.book, it.chapter, it.verse)
    const m: Mark = { ...out[k], t: now }
    if (it.color) { m.c = it.color; highlights++; if (it.version) m.v = it.version }
    if (it.bookmark) { m.b = 1; bookmarks++ }
    if (it.note) {
      // Don't overwrite a note you already have; add the imported one under it.
      m.n = m.n && !m.n.includes(it.note) ? `${m.n}\n\n${it.note}` : it.note
      m.nt = now; notes++
    }
    out[k] = m
  }
  return { marks: out, highlights, bookmarks, notes }
}

/** Our own backup format. */
export interface Backup { app: 'plain-bible'; version: 1; exported: string; marks: Marks; settings?: unknown }
export function isBackup(x: unknown): x is Backup {
  return !!x && typeof x === 'object' && (x as Backup).app === 'plain-bible' && typeof (x as Backup).marks === 'object'
}
