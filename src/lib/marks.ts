// Personal highlights and bookmarks. Marks belong to a verse, not to a
// translation, so a highlight shows in every version you read.
import { BOOK_INDEX, findBook } from './books'
import type { PrayerVerse } from './prayerVerses'

/** One note. A verse can have several, each edited and synced on its own. */
export interface Note {
  /** the text; missing once the note is deleted (kept so the deletion syncs) */
  n?: string
  /** the verses it is about, when more than the one it lives on (sorted,
   *  includes that verse) */
  v?: number[]
  /** when it was written, for ordering */
  c: number
  /** when it last changed */
  t: number
}

export interface Mark {
  /** highlight color, e.g. "#fff193" */
  c?: string
  /** bookmarked */
  b?: 1
  /** version it was made in (informational) */
  v?: string
  /** your notes, by id. A note on a passage lives on its first verse. */
  ns?: Record<string, Note>
  /** Older single note, its verses and when it changed. Read once and moved
   *  into `ns` (as note "0"). */
  n?: string
  nv?: number[]
  nt?: number
  /** last changed, ms since epoch. A mark with no color, bookmark or note
   *  records a removal, so that it syncs to other devices. Notes keep their
   *  own times, so notes and highlights on one verse merge separately. */
  t: number
}
/** key: "John.3.16" */
export type Marks = Record<string, Mark>

import { N_ } from '../i18n'

/** The highlight colours; each name is translated where it's shown. */
export const PALETTE: { color: string; name: string }[] = [
  { color: '#fff193', name: N_('Yellow') },
  { color: '#b3e487', name: N_('Green') },
  { color: '#cae1fe', name: N_('Blue') },
  { color: '#80cbc4', name: N_('Teal') },
  { color: '#dac6ff', name: N_('Purple') },
  { color: '#ffc9e4', name: N_('Pink') },
  { color: '#ffc595', name: N_('Orange') },
  { color: '#ffadaf', name: N_('Red') },
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

/** Moves an older single note into the notes list. The id is fixed, so
 *  every device moving the same note agrees and it isn't doubled. */
export function upgrade(m: Mark): Mark {
  if (m.n === undefined && m.nt === undefined && m.nv === undefined) return m
  const { n, nv, nt, ...rest } = m
  const t = nt ?? m.t
  const old: Note = { c: t, t }
  if (n) { old.n = n; if (nv && nv.length > 1) old.v = nv }
  const cur = rest.ns?.['0']
  return { ...rest, ns: { ...rest.ns, '0': cur && cur.t >= t ? cur : old } }
}

/** A verse's notes that still have text, oldest first, with their ids. */
export function notesOf(m: Mark | undefined): (Note & { id: string; n: string })[] {
  if (!m) return []
  m = upgrade(m)
  return Object.entries(m.ns ?? {}).filter(([, x]) => x && x.n).map(([id, x]) => ({ ...x, id, n: x.n! }))
    .sort((a, b) => a.c - b.c || (a.id < b.id ? -1 : 1))
}

/** Whether a mark holds anything to show (not just a removal record). */
export const hasContent = (m: Mark | undefined) => !!(m && (m.c || m.b || notesOf(m).length))

/** A mark with nothing left becomes a bare removal record (keeping the
 *  records of deleted notes). */
export function tidy(m: Mark): Mark {
  m = upgrade(m)
  if (hasContent(m)) return m
  return m.ns && Object.keys(m.ns).length ? { t: m.t, ns: m.ns } : { t: m.t }
}

/** Merge two versions of one verse's mark: the newer one wins for the
 *  highlight and bookmark, and each note keeps its own newest version. */
export function mergeMark(a: Mark | undefined, b: Mark | undefined): Mark | undefined {
  if (!a || !b) return a ? tidy(a) : b && tidy(b)
  a = upgrade(a); b = upgrade(b)
  const out: Mark = { ...((b.t ?? 0) > (a.t ?? 0) ? b : a) }
  const ns: Record<string, Note> = { ...a.ns }
  for (const [id, x] of Object.entries(b.ns ?? {})) {
    const y = ns[id]
    // Same age: a deletion wins, so a note can't come back by a tie.
    if (!y || x.t > y.t || (x.t === y.t && y.n !== undefined && (x.n === undefined || x.n > y.n))) ns[id] = x
  }
  delete out.ns
  if (Object.keys(ns).length) out.ns = ns
  return tidy(out)
}

/** A new note's id: when it was made, plus a little randomness so two
 *  devices never pick the same one. */
export const newNoteId = (now = Date.now()) => now.toString(36) + Math.random().toString(36).slice(2, 6)

/** Write, edit or delete (empty text) one note on `key`. `verses` are all
 *  the verses it is about. */
export function setNote(marks: Marks, key: string, id: string, text: string, now = Date.now(), verses?: number[]): Marks {
  const m = upgrade({ ...marks[key], t: marks[key]?.t ?? now })
  const prev = m.ns?.[id]
  const n = text.trim()
  if (!n && !prev) return marks
  const note: Note = { c: prev?.c ?? now, t: now }
  if (n) { note.n = n; const vs = verses ?? prev?.v; if (vs && vs.length > 1) note.v = vs }
  return { ...marks, [key]: tidy({ ...m, ns: { ...m.ns, [id]: note } }) }
}

export interface FoundNote extends Note { id: string; n: string; key: string; verse: number; verses: number[] }

/** Every note in this chapter that covers verse `v`: its own, and passage
 *  notes that start on an earlier verse. Oldest first. */
export function notesCovering(marks: Marks, book: string, chapter: number, v: number): FoundNote[] {
  const out: FoundNote[] = []
  for (let s = Math.max(1, v - 200); s <= v; s++) {
    const key = markKey(book, chapter, s), m = marks[key]
    if (!m) continue
    for (const x of notesOf(m)) {
      const verses = x.v ?? [s]
      if (s === v || verses.includes(v)) out.push({ ...x, key, verse: s, verses })
    }
  }
  return out.sort((a, b) => a.c - b.c)
}

const KEY = 'plain-bible:marks'
export function loadMarks(): Marks {
  let m: Marks
  try { m = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {}
  // Startup must never fail over one odd entry: anything unreadable is
  // left out.
  const out: Marks = {}
  for (const k in m) {
    const x = m[k]
    if (!x || typeof x !== 'object') continue
    try { out[k] = upgrade(x) } catch { /* skip it */ }
  }
  return out
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
    const m: Mark = upgrade({ ...out[k], t: now })
    if (it.color) { m.c = it.color; highlights++; if (it.version) m.v = it.version }
    if (it.bookmark) { m.b = 1; bookmarks++ }
    if (it.note) {
      // A note of its own, next to any you already have (once).
      if (!notesOf(m).some(x => x.n === it.note!.trim())) {
        Object.assign(m, setNote({ [k]: m }, k, newNoteId(now), it.note, now)[k])
      }
      notes++
    }
    out[k] = m
  }
  return { marks: out, highlights, bookmarks, notes }
}

/** The backup's name inside a Download everything .zip. */
export const BACKUP_FILE = 'my-quiet-bible-backup.json'
/** A prayer in a backup: its audio is in the same .zip, one file per part. */
export interface BackupPrayer { id: string; at: number; verses?: PrayerVerse[]; parts: { file: string; ms: number; type: string }[] }
/** Our own backup format. `prayers` only in a .zip from Download everything. */
export interface Backup { app: 'plain-bible'; version: 1; exported: string; marks: Marks; settings?: unknown; prayers?: BackupPrayer[] }
export function isBackup(x: unknown): x is Backup {
  return !!x && typeof x === 'object' && (x as Backup).app === 'plain-bible' && typeof (x as Backup).marks === 'object'
}
